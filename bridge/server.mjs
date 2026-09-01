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

// A turn that produces nothing for this long is treated as lost, so the bridge can never wedge
// in a permanently busy state. Generous: a real turn may run tools silently for a while.
const TURN_TIMEOUT_MS = Number(process.env.BRIDGE_TURN_TIMEOUT_MS || 3 * 60 * 1000);

const PI_DIR = process.env.PI_CODING_AGENT_DIR || "/app/.pi";
// Voice needs a fast answer, not the best one — Home Assistant gives up on a slow turn, and a
// reasoning model can spend a minute thinking before it says "hallo". So the bridge pins its own
// model and thinking level rather than inheriting settings.json, which is tuned for the CLI.
// Leave BRIDGE_MODEL empty to fall back to pi's default.
const MODEL_ARG = process.env.BRIDGE_MODEL || "";
const THINKING_ARG = process.env.BRIDGE_THINKING || "off";
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
// A turn moves pending -> active only once pi has ACCEPTED our prompt. That ordering is what
// stops a late event from an earlier turn closing the request we are serving now: while we wait
// for the acceptance, `active` is null and stray events are ignored.
let pending = null;
let active = null;
let turnId = 0;
let idleTimer = null;
let turnTimer = null;

function spawnPi() {
  const args = ["--mode", "rpc"];

  for (const ext of EXTENSIONS) {
    args.push("-e", `${PI_DIR}/extensions/${ext}`);
  }

  // Voice needs a different register than the terminal: short, spoken, no markdown.
  args.push("--append-system-prompt", "/app/bridge/voice-profile.md");
  args.push("--name", "Home Assistant voice");

  // Pinned here rather than inherited from settings.json, which is tuned for the CLI. A reasoning
  // model spent 88 seconds answering "hallo" — Home Assistant abandons a turn long before that.
  if (MODEL_ARG) {
    args.push("--model", MODEL_ARG);
  }

  args.push("--thinking", THINKING_ARG);

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
  // The reply to our own prompt command, correlated by id. pi rejects a prompt outright when the
  // agent is already streaming, so this is the only place we learn whether the turn ever started.
  if (event.type === "response" && event.command === "prompt") {
    if (!pending || event.id !== pending.id) {
      return;
    }

    const turn = pending;
    pending = null;

    if (event.success) {
      active = turn;
      armTurnTimeout();
    }
    else {
      log(`prompt rejected (turn ${turn.id})`);
      turn.end("Core is still working on the last request. Ask me again in a moment.");
    }
    return;
  }

  if (!active) {
    return;
  }

  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent;

    // Only spoken text goes out. Thinking must not reach the dialog, and the Ollama protocol has
    // no channel for tool activity at all.
    if (delta?.type === "text_delta" && delta.delta) {
      // Text arriving is proof the turn is alive, so push the deadline back.
      armTurnTimeout();
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

// A turn that goes this long without producing text is treated as lost. Without this the busy
// flag can outlive its turn, and the bridge answers "still working" forever — only a container
// restart clears it.
function armTurnTimeout() {
  clearTimeout(turnTimer);
  turnTimer = setTimeout(() => {
    log(`turn ${(active || pending)?.id} produced nothing for ${TURN_TIMEOUT_MS}ms — aborting`);
    send({ type: "abort" });
    finish("Core took too long and gave up. Please ask again.");
  }, TURN_TIMEOUT_MS);
}

function finish(fallback) {
  clearTimeout(turnTimer);

  // A prompt still awaiting acceptance has to be closed out too, or its caller hangs.
  const turn = active || pending;

  if (!turn) {
    return;
  }

  active = null;
  pending = null;
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
  // can no longer see, so say so and stop instead. pi enforces this too and will reject the
  // prompt; checking here just saves the round trip.
  if (active || pending) {
    res.end(chunkLine("Core is still working on the last request. Ask me again in a moment.", true));
    return;
  }

  const id = String(++turnId);
  let wrote = false;

  pending = {
    id,
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
    const turn = active || pending;

    if (turn?.id === id && res.writableEnded === false) {
      turn.chunk = () => {};
    }
  });

  clearTimeout(idleTimer);
  // Armed now, not on acceptance: if pi never answers the prompt command at all, this is what
  // rescues the caller.
  armTurnTimeout();
  send({ id, type: "prompt", message: last.content });
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
