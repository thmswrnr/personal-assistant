#!/usr/bin/env node
// Core's scheduler — runs as the core container's main process (keeps it alive and
// fires scheduled jobs). Independent of Telegram: it runs Core prompts at the scheduled
// times; what happens with the result is up to the prompt (save an email draft, write a
// note, `notify` you on Telegram, …). `core.sh` interactive use runs alongside.
//
// The schedule is storage/schedule.json — a writable data file so Core can manage it
// (see the `schedule` skill) and it reloads live. Each job uses a standard 5-field cron
// expression (minute hour day-of-month month day-of-week), evaluated in local time (TZ):
//   { "label": "Morning briefing", "cron": "0 7 * * *",   "prompt": "/skill:morning-briefing" }
//   { "label": "Weekday standup",  "cron": "30 8 * * 1-5", "prompt": "..." }
//   { "label": "Hourly mail",      "cron": "0 * * * *",   "prompt": "..." }
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const MODEL = process.env.CORE_MODEL ?? "local/local-model";
const EXT = "/app/.pi/extensions/context-saver.mjs";
const FILE = process.env.SCHEDULE_FILE ?? "/app/storage/schedule.json";
const log = (...a) => console.log("[scheduler]", ...a);

// --- minimal cron matcher: *, lists (a,b), ranges (a-b), steps (*/n, a-b/n) ---
function matchField(expr, value, min, max) {
  return String(expr).split(",").some((part) => {
    let [range, step] = part.split("/");
    step = step ? Number(step) : 1;
    let lo, hi;
    if (range === "*") { lo = min; hi = max; }
    else if (range.includes("-")) { const [a, b] = range.split("-").map(Number); lo = a; hi = b; }
    else { lo = hi = Number(range); }
    if (Number.isNaN(lo) || Number.isNaN(hi) || value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  });
}
function cronMatch(expr, d) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return false;
  return (
    matchField(f[0], d.getMinutes(), 0, 59) &&
    matchField(f[1], d.getHours(), 0, 23) &&
    matchField(f[2], d.getDate(), 1, 31) &&
    matchField(f[3], d.getMonth() + 1, 1, 12) &&
    matchField(f[4], d.getDay(), 0, 6) // 0 = Sunday
  );
}

function runAgent(prompt) {
  return new Promise((resolve) => {
    // detached so we can kill the whole process tree on timeout (a hung/runaway run must
    // not block later scheduled jobs).
    // stdin MUST be ignored: with an open stdin pipe, `pi -p` runs but then waits on stdin
    // forever and never exits. detached → own process group for timeout-kill.
    const p = spawn("pi", ["-p", prompt, "--model", MODEL, "-e", EXT], { cwd: "/app", detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch { /* gone */ } }
      finish({ code: -1, out: out.trim(), err: "timed out after 300s" });
    }, 300000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => finish({ code, out: out.trim(), err: err.trim() }));
    p.on("error", (e) => finish({ code: -1, out: "", err: String(e) }));
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
    return []; // missing/invalid file = nothing scheduled
  }
}

const lastFired = {}; // label → "YYYY-MM-DDTHH:MM" so each job fires at most once per minute
function tick() {
  const now = new Date();
  const minute = now.toString().slice(0, 21); // coarse minute key (local)
  loadSchedule().forEach((e, i) => {
    if (!e || !e.prompt || !e.cron) return;
    const key = e.label || `job${i}`;
    try {
      if (cronMatch(e.cron, now) && lastFired[key] !== minute) {
        lastFired[key] = minute;
        enqueue(key, e.prompt);
      }
    } catch (err) {
      log(`bad cron for "${key}": ${e.cron} (${err.message})`);
    }
  });
}

log(`starting (model=${MODEL}, schedule=${FILE})`);
setInterval(tick, 60000);
process.stdin.resume(); // keep the container alive
