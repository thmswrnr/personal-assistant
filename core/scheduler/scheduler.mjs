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
//
// Optional `watch`: a cheap shell command used as a GATE. When present, `cron` is the
// CHECK cadence — on each match the watch runs (deterministic, no LLM, outside the job
// queue); the `prompt` fires only if the watch exits 0. This is how file-watching and
// service-polling fit: the watch is the cheap "did anything change?" check, the prompt is
// the (expensive) reaction. Make the watch edge-triggered — self-clearing (the reaction
// removes the condition, e.g. process-inbox empties the inbox) or cursor-based (the script
// records what it last saw and exits 0 only on something newer) — or it re-fires every tick.
//   { "label": "Inbox", "cron": "*/2 * * * *",
//     "watch": "ls /app/storage/inbox | grep -q .", "prompt": "/skill:process-inbox" }
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

// Model is pi's own default (settings.json: defaultProvider/defaultModel). Set CORE_MODEL
// only to override it for scheduled jobs; otherwise we pass no --model and let pi decide.
const MODEL = process.env.CORE_MODEL ?? "";
// Core's context extensions — one dedicated concern each (spill, loop guard, memory). Loaded with
// one -e apiece (pi's arg parser accepts repeated -e). Compaction stays native to pi.
const EXT_DIR = "/app/.pi/extensions";
const EXT_ARGS = ["spill", "loop-guard", "memory"].flatMap((n) => ["-e", `${EXT_DIR}/${n}.mjs`]);
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
    // --no-session: scheduled jobs are stateless one-shots — don't leave a session file behind.
    const args = ["-p", prompt, "--no-session", ...(MODEL ? ["--model", MODEL] : []), ...EXT_ARGS];
    const p = spawn("pi", args, { cwd: "/app", detached: true, stdio: ["ignore", "pipe", "pipe"] });
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

// Cheap gate for `watch` jobs: run a shell command and resolve its exit code. Runs OUTSIDE
// the LLM queue (it's not a Core run) so frequent checks never starve real jobs. Short
// timeout so a hung watch can't pile up; timeout/error → non-zero (no fire).
function runWatch(cmd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, { cwd: "/app", shell: true, detached: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "", done = false;
    const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve(code); };
    const timer = setTimeout(() => {
      try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch { /* gone */ } }
      finish(-1);
    }, 30000);
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => finish(code ?? -1));
    p.on("error", () => finish(-1));
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
  let raw;
  try {
    raw = readFileSync(FILE, "utf8");
  }
  catch (err) {
    // A missing file is the normal "no schedule yet" case — stay quiet. Anything else
    // (e.g. a permissions problem) is worth surfacing in the logs.
    if (err.code !== "ENOENT") log(`warning: could not read ${FILE}: ${err.message}`);
    return [];
  }
  let j;
  try {
    j = JSON.parse(raw);
  }
  catch (err) {
    log(`warning: ${FILE} is not valid JSON (${err.message}) — nothing scheduled`);
    return [];
  }
  if (!Array.isArray(j)) {
    log(`warning: ${FILE} must be a JSON array of jobs — nothing scheduled`);
    return [];
  }
  return j;
}

const lastFired = {}; // label → "YYYY-MM-DDTHH:MM" so each job fires at most once per minute
function tick() {
  const now = new Date();
  const minute = now.toISOString().slice(0, 16); // per-minute dedup key, e.g. "2026-06-18T12:03"
  loadSchedule().forEach((e, i) => {
    if (!e || !e.prompt || !e.cron) return;
    const key = e.label || `job${i}`;
    try {
      if (cronMatch(e.cron, now) && lastFired[key] !== minute) {
        lastFired[key] = minute; // per-minute guard: check at most once per matched minute
        if (e.watch) {
          // gated job: cron is the check cadence; fire the prompt only if the watch passes.
          runWatch(e.watch).then((code) => {
            if (code === 0) enqueue(key, e.prompt);
            else log(`watch "${key}" → no fire (exit ${code})`);
          });
        } else {
          enqueue(key, e.prompt); // plain time job
        }
      }
    } catch (err) {
      log(`bad cron for "${key}": ${e.cron} (${err.message})`);
    }
  });
}

log(`starting (model=${MODEL || "pi default (settings.json)"}, schedule=${FILE})`);
setInterval(tick, 60000);
process.stdin.resume(); // keep the container alive
