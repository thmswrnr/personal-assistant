#!/usr/bin/env node
// Core's scheduler — runs as the core container's main process (keeps it alive and
// fires scheduled jobs). Independent of Telegram: it just runs Core prompts at set
// times; what happens with the result is up to the prompt (e.g. save an email draft,
// write a note, or `notify` you on Telegram). `core.sh` interactive use runs alongside.
//
// schedule.json is an array of jobs (re-read every tick, so edits apply live):
//   { "label": "...", "at": "07:00", "prompt": "..." }        // daily at local HH:MM
//   { "label": "...", "everyMinutes": 60, "prompt": "..." }    // every N minutes
// Empty array = nothing scheduled. See schedule.example.json.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const MODEL = process.env.CORE_MODEL ?? "local/local-model";
const EXT = "/app/.pi/extensions/context-saver.mjs";
const FILE = process.env.SCHEDULE_FILE ?? "/app/scheduler/schedule.json";
const log = (...a) => console.log("[scheduler]", ...a);

function runAgent(prompt) {
  return new Promise((resolve) => {
    const p = spawn("pi", ["-p", prompt, "--model", MODEL, "-e", EXT], { cwd: "/app" });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    p.on("error", (e) => resolve({ code: -1, out: "", err: String(e) }));
  });
}

// One job at a time (single GPU).
let busy = false;
const queue = [];
async function enqueue(label, prompt) {
  queue.push({ label, prompt });
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    log(`running: ${job.label}`);
    const r = await runAgent(job.prompt);
    if (r.out) log(`done: ${job.label}\n${r.out}`);
    else log(`done: ${job.label} (exit ${r.code})${r.err ? " " + r.err : ""}`);
  }
  busy = false;
}

function loadSchedule() {
  try {
    const j = JSON.parse(readFileSync(FILE, "utf8"));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

const lastFired = {};
const primed = new Set();
function tick() {
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5); // local time (TZ env)
  const day = now.toISOString().slice(0, 10);
  loadSchedule().forEach((e, i) => {
    if (!e || !e.prompt) return;
    const key = e.label || `job${i}`;
    if (e.at) {
      const stamp = `${day} ${e.at}`;
      if (hhmm === e.at && lastFired[key] !== stamp) {
        lastFired[key] = stamp;
        enqueue(key, e.prompt);
      }
    } else if (e.everyMinutes) {
      if (!primed.has(key)) { primed.add(key); lastFired[key] = Date.now(); return; } // don't fire on startup
      if (Date.now() - (lastFired[key] || 0) >= e.everyMinutes * 60000) {
        lastFired[key] = Date.now();
        enqueue(key, e.prompt);
      }
    }
  });
}

log(`starting (model=${MODEL}, schedule=${FILE})`);
setInterval(tick, 60000);
process.stdin.resume(); // keep the container alive
