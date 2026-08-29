#!/usr/bin/env node
// Core, wearing an Ollama server's clothes.
//
// Home Assistant's built-in Ollama integration is the only maintained conversation agent that
// accepts an arbitrary server URL, so Core imitates one. The integration calls exactly two
// endpoints:
//
//   GET  /api/tags   at config-flow validation and at every entry load
//   POST /api/chat   NDJSON, one JSON object per line, streamed
//
// It never pulls: a pull only happens when the name in HA's "Model" field is missing from
// /api/tags, and we always list it. That field selects nothing — it is a label the protocol
// demands. Core picks its own LLM from data/pi/settings.json, exactly as it does on the CLI.
//
// Behind the HTTP layer sits ONE long-lived `pi --mode rpc` process. Voice is one person talking
// to one assistant, so a single session is enough — and it gives conversational continuity and
// Core's long-term memory for free. HA sends its own `messages` history; we ignore all but the
// newest user message and let pi's session hold the thread.

import { createServer } from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.BRIDGE_PORT || 11434);
const MODEL = "core";
// Start a fresh pi session after this much silence, so yesterday's conversation does not leak
// into today's first question.
const IDLE_RESET_MS = Number(process.env.BRIDGE_IDLE_RESET_MS || 30 * 60 * 1000);

const PI_DIR = process.env.PI_CODING_AGENT_DIR || "/app/.pi";
// The same extensions core.sh loads, so the voice Core and the terminal Core are the same agent.
const EXTENSIONS = [
  "spill-to-file.mjs",
  "loop-guard.mjs",
  "tool-call-guard.mjs",
  "memory.mjs",
  "memory-capture.mjs",
];

const log = (...args) => console.error("[bridge]", ...args);

// ── the pi process ────────────────────────────────────────────────────────────────────────────

let pi = null;
// Set while a turn is in flight; holds the callbacks of the HTTP response being streamed to.
let active = null;
let idleTimer = null;

function spawnPi() {
  const args = ["--mode", "rpc"];

  for (const ext of EXTENSIONS) {
    args.push("-e", `${PI_DIR}/extensions/${ext}`);
  }

  // Voice needs a different register than the terminal: short, spoken, no markdown.
  args.push("--append-system-prompt", "/app/bridge/voice-profile.md");
  args.push("--name", "Home Assistant voice");

  log("starting pi", args.join(" "));
  const child = spawn("pi", args, { cwd: "/app", stdio: ["pipe", "pipe", "inherit"] });

  child.on("exit", (code) => {
    log(`pi exited (${code}) — restarting`);
    // A turn in flight dies with the process. Close it out so the caller is not left hanging.
    finish("Core stopped unexpectedly. Please ask again.");
    pi = null;
  });

  readEvents(child.stdout, onEvent);
  return child;
}

function pi_() {
  if (!pi) {
    pi = spawnPi();
  }
  return pi;
}

function send(command) {
  pi_().stdin.write(`${JSON.stringify(command)}\n`);
}

// RPC mode uses strict JSONL: LF is the ONLY record delimiter. Node's readline also splits on
// U+2028 and U+2029, which are legal inside JSON strings, so it would corrupt the stream. Hence
// this buffer-and-split reader rather than readline.
function readEvents(stream, onLine) {
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const records = buffer.split("\n");
    buffer = records.pop();

    for (const record of records) {
      const line = record.endsWith("\r") ? record.slice(0, -1) : record;

      if (line.trim() === "") {
        continue;
      }

      try {
        onLine(JSON.parse(line));
      }
      catch (e) {
        log("unparseable RPC line:", e.message);
      }
    }
  });
}

function onEvent(event) {
  if (!active) {
    return;
  }

  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent;

    // Only spoken text goes out. Thinking must not reach the dialog, and the Ollama protocol has
    // no channel for tool activity at all.
    if (delta?.type === "text_delta" && delta.delta) {
      active.chunk(delta.delta);
    }
    return;
  }

  if (event.type === "agent_end") {
    // A retry means the run is not over — pi is about to try the turn again.
    if (event.willRetry) {
      return;
    }
    finish();
  }
}

// ── one turn at a time ────────────────────────────────────────────────────────────────────────

function finish(fallback) {
  if (!active) {
    return;
  }

  const turn = active;
  active = null;
  turn.end(fallback);
  scheduleIdleReset();
}

function scheduleIdleReset() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pi && !active) {
      log("idle — starting a fresh session");
      send({ type: "new_session" });
    }
  }, IDLE_RESET_MS);
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

function chunkLine(content, done, doneReason) {
  const chunk = {
    model: MODEL,
    created_at: now(),
    message: { role: "assistant", content },
    done,
  };

  if (done) {
    chunk.done_reason = doneReason || "stop";
  }

  return `${JSON.stringify(chunk)}\n`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleChat(req, res) {
  let payload;

  try {
    payload = JSON.parse((await readBody(req)) || "{}");
  }
  catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `bad request body: ${e.message}` }));
    return;
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const last = [...messages].reverse().find((m) => m.role === "user");

  if (!last?.content) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no user message" }));
    return;
  }

  res.writeHead(200, { "content-type": "application/x-ndjson" });

  // One agent, one turn at a time. Queueing would let a second question steer a turn the caller
  // can no longer see, so say so and stop instead.
  if (active) {
    res.end(chunkLine("Core is still working on the last request. Ask me again in a moment.", true));
    return;
  }

  let wrote = false;

  active = {
    chunk(text) {
      wrote = true;
      res.write(chunkLine(text, false));
    },
    end(fallback) {
      if (!wrote && fallback) {
        res.write(chunkLine(fallback, false));
      }
      res.end(chunkLine("", true));
    },
  };

  // If Home Assistant hangs up (its own timeout, or the user closed the dialog), stop streaming
  // into a dead socket — but let the turn finish, so Core's session stays consistent.
  res.on("close", () => {
    if (active && res.writableEnded === false) {
      active.chunk = () => {};
    }
  });

  clearTimeout(idleTimer);
  send({ type: "prompt", message: last.content });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://bridge");

  // The one entry HA's config flow validates against. Reporting it is what stops HA from trying
  // to pull a model.
  if (req.method === "GET" && url.pathname === "/api/tags") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      models: [{
        name: MODEL,
        model: MODEL,
        modified_at: now(),
        size: 0,
        digest: MODEL,
        details: { family: MODEL, parameter_size: "", quantization_level: "" },
      }],
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  log(`listening on ${PORT}`);
  pi_();
});
