// Autonomous memory capture for Core.
//
// Core's long-term memory (the `memory` skill + the [[memory]] injection extension) is otherwise
// MANUAL — a fact is saved only when the user says "remember that". This extension closes that
// gap: at the end of an interactive session it runs a one-shot extraction pass over the
// conversation and saves any durable PERSONAL facts through the SAME store — no user action,
// no end-of-session prompt (silent by design: you're leaving the session).
//
// Design lifted from @samfp/pi-memory, minus its bundled local-embeddings stack:
//   - accumulate each turn's messages on `agent_end`
//   - on `session_shutdown` (and on `/new` / `/resume` via `session_before_switch`), if the
//     session had enough conversation, spawn a lean one-shot `pi -p` extraction on a fast Alan
//     model, parse its JSON, and `memory.mjs save` each NEW fact (slug not already in the index)
//   - storage + recall are UNCHANGED: facts land as markdown under storage/memory/ and the
//     [[memory]] extension keeps injecting the index every run
//
// Recursion guard (belt + suspenders): the extraction sub-run carries no `-e` (so this module is
// never discovered/loaded in it) AND we set CORE_MEMORY_CONSOLIDATING=1, on which this module
// no-ops. Everything is best-effort — a failure or timeout must never block session shutdown.
//
// One dedicated concern, loaded via its own `-e` on every Core entry point. Only does work in
// interactive sessions; one-shot/scheduled runs are `--no-session` and below the message gate.
// See also [[memory]] (injection), [[spill-to-file]], [[loop-guard]], [[tool-call-guard]].

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const MIN_USER_MESSAGES = 3;     // skip trivial sessions
const MAX_PAIRS = 30;            // cap the conversation fed to the extractor
const SUBRUN_TIMEOUT_MS = 45_000;

const MEMORY_DIR = process.env.CORE_MEMORY_DIR ?? "/app/storage/memory";
const INDEX = `${MEMORY_DIR}/MEMORY.md`;
const MEMORY_CLI = "/app/.pi/skills/assistant/memory/scripts/memory.mjs";
// A fast (no-reasoning) Alan model keeps session exit snappy; cost is 0. Override via env.
const MODEL = process.env.CORE_MEMORY_MODEL ?? "api/comma-soft/gemma4-31b-instant";

const TYPES = ["user", "preference", "project", "reference"];
const VALID_SLUG = /^[a-z0-9][a-z0-9-]*$/;

// Personal-assistant extraction prompt (re-domained from @samfp/pi-memory's CONSOLIDATION_PROMPT).
const EXTRACTION_PROMPT = `You are Core's memory-extraction step. Read the conversation below and pull out durable, reusable PERSONAL facts worth recalling in FUTURE sessions — not a summary of what happened.

Extract things like:
- Who the user is: name, where they live, work/role, languages, household, key people (family, colleagues).
- Stable PREFERENCES: how they like things done, things to always or never do, tastes, routines.
- Ongoing PROJECTS or goals they are actively pursuing.
- Useful REFERENCES they will want again: an account id, a dashboard URL, a recurring place.

Do NOT extract (these pollute memory):
- One-off or ephemeral details, the current task, or "what we did today".
- Anything already in the "Current memory" list below — do not duplicate; emit again ONLY if it changed.
- Secrets of any kind (passwords, PINs, door/locker codes, API keys) — never store these.
- Anything trivially re-derivable (today's weather, a one-time calculation).

Rules:
- Emit a fact only if you are confident it is lasting, not a passing mention.
- Each fact needs: a stable kebab-case "slug" (e.g. "user-home", "pref-briefing"), a "type" (one of: user, preference, project, reference), a one-line "desc" (what the fact is FOR — used later to decide whether to open it), and a concise "body" (the fact itself, under 200 chars, absolute dates not relative).

Respond with ONLY valid JSON, no prose:
{ "facts": [ { "slug": "string", "type": "user|preference|project|reference", "desc": "string", "body": "string" } ] }
If there is nothing durable to save, respond exactly: { "facts": [] }`;

const textOf = (content) => {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.filter((c) => c?.type === "text").map((c) => c.text).join("\n").trim();
};

const truncate = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);

function isValidFact(f) {
  return (
    f &&
    typeof f.slug === "string" && VALID_SLUG.test(f.slug) && f.slug.length <= 60 &&
    typeof f.type === "string" && TYPES.includes(f.type) &&
    typeof f.desc === "string" && f.desc.trim().length > 0 &&
    typeof f.body === "string" && f.body.trim().length > 0 && f.body.length <= 500
  );
}

function parseFacts(text) {
  // The model should return pure JSON, but tolerate ```json fences or surrounding prose.
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!m) {
    return [];
  }
  try {
    const parsed = JSON.parse(m[1].trim());
    return Array.isArray(parsed.facts) ? parsed.facts : [];
  }
  catch {
    return [];
  }
}

export default function register(pi) {
  // Recursion guard: never run inside our own extraction sub-run.
  if (process.env.CORE_MEMORY_CONSOLIDATING === "1") {
    return;
  }

  const userMessages = [];
  const assistantMessages = [];
  let consolidating = false;

  pi.on("agent_end", async (event) => {
    for (const msg of event.messages ?? []) {
      if (!msg || !("content" in msg)) {
        continue;
      }
      const text = textOf(msg.content);
      if (!text) {
        continue;
      }
      if (msg.role === "user") {
        userMessages.push(text);
      }
      else if (msg.role === "assistant") {
        assistantMessages.push(text);
      }
    }
    // Bound memory on very long sessions.
    while (userMessages.length > 80) {
      userMessages.shift();
    }
    while (assistantMessages.length > 80) {
      assistantMessages.shift();
    }
  });

  // End of an interactive session (exit / Ctrl-C), and also when switching away (/new, /resume).
  pi.on("session_shutdown", () => consolidate());
  pi.on("session_before_switch", () => consolidate());

  async function consolidate() {
    if (consolidating || userMessages.length < MIN_USER_MESSAGES) {
      return;
    }
    consolidating = true;
    try {
      const facts = await extract();
      if (facts.length) {
        await saveNew(facts);
      }
    }
    catch {
      // Best-effort — never block shutdown.
    }
    finally {
      // Don't re-extract the same conversation on a later trigger.
      userMessages.length = 0;
      assistantMessages.length = 0;
      consolidating = false;
    }
  }

  // Spawn a lean one-shot pi run that returns the extracted facts as JSON on stdout.
  function extract() {
    let currentMemory = "";
    try {
      currentMemory = readFileSync(INDEX, "utf8").trim();
    }
    catch {
      // no memory yet
    }

    const convo = [];
    const n = Math.min(userMessages.length, MAX_PAIRS);
    const uStart = userMessages.length - n;
    const aStart = Math.max(0, assistantMessages.length - n);
    for (let i = 0; i < n; i++) {
      convo.push(`User: ${truncate(userMessages[uStart + i], 1000)}`);
      const a = assistantMessages[aStart + i];
      if (a) {
        convo.push(`Assistant: ${truncate(a, 600)}`);
      }
    }

    const prompt =
      EXTRACTION_PROMPT +
      (currentMemory ? `\n\n## Current memory (do not duplicate)\n${truncate(currentMemory, 2000)}` : "") +
      `\n\n## Conversation\n${convo.join("\n\n")}`;

    return new Promise((resolve) => {
      const args = ["-p", prompt, "--no-session", "--no-extensions", "--no-tools", "--no-skills", "--model", MODEL];
      const child = spawn("pi", args, {
        cwd: "/app",
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CORE_MEMORY_CONSOLIDATING: "1" },
      });
      let out = "";
      let done = false;
      const finish = (facts) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve(facts);
      };
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        }
        catch {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
        }
        finish([]);
      }, SUBRUN_TIMEOUT_MS);
      child.stdout.on("data", (d) => (out += d));
      child.on("close", () => finish(parseFacts(out)));
      child.on("error", () => finish([]));
    });
  }

  // Save each valid, NOT-already-stored fact via the `memory` skill's CLI (which writes the file
  // and regenerates the index). Dedup by slug against the current index.
  function saveNew(facts) {
    let index = "";
    try {
      index = readFileSync(INDEX, "utf8");
    }
    catch {
      // none yet
    }
    const tasks = [];
    for (const f of facts) {
      if (!isValidFact(f)) {
        continue;
      }
      if (index.includes(`(${f.slug}.md)`)) {
        continue; // already in memory
      }
      tasks.push(saveOne(f));
    }
    return Promise.all(tasks);
  }

  function saveOne(f) {
    return new Promise((resolve) => {
      const args = [MEMORY_CLI, "save", "--slug", f.slug, "--type", f.type, "--desc", f.desc, "--body", f.body];
      const child = spawn("node", args, { cwd: "/app", stdio: "ignore" });
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  }
}
