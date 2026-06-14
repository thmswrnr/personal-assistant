#!/usr/bin/env node
// Manage Core's scheduled jobs in storage/schedule.json. The scheduler (core's main
// process) runs these; edits here apply live. No third-party deps.
//
//   node schedule.mjs list
//   node schedule.mjs add --label "Morning briefing" --cron "0 7 * * *" --prompt "/skill:morning-briefing"
//   node schedule.mjs remove --label "Morning briefing"
//
// cron = standard 5 fields: minute hour day-of-month month day-of-week (local time).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.env.SCHEDULE_FILE ?? "/app/storage/schedule.json";

function die(m) { console.error(`schedule: ${m}`); process.exit(1); }
function load() { try { const j = JSON.parse(readFileSync(FILE, "utf8")); return Array.isArray(j) ? j : []; } catch { return []; } }
function save(j) { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(j, null, 2) + "\n"); }
function flags(a) { const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith("--")) o[a[i].slice(2)] = a[++i] ?? ""; return o; }
const validCron = (c) => typeof c === "string" && c.trim().split(/\s+/).length === 5;

const [cmd, ...rest] = process.argv.slice(2);
let jobs = load();
switch (cmd) {
  case "list":
    console.log(JSON.stringify({ count: jobs.length, jobs }, null, 2));
    break;
  case "add": {
    const f = flags(rest);
    if (!f.cron || !f.prompt) die('usage: add --label "X" --cron "0 7 * * *" --prompt "..."');
    if (!validCron(f.cron)) die(`invalid cron "${f.cron}" — need 5 fields: minute hour day-of-month month day-of-week`);
    const job = { label: f.label || `job-${jobs.length + 1}`, cron: f.cron.trim(), prompt: f.prompt };
    jobs.push(job);
    save(jobs);
    console.log(JSON.stringify({ added: job, total: jobs.length }, null, 2));
    break;
  }
  case "remove": {
    const f = flags(rest);
    if (!f.label) die('usage: remove --label "X"');
    const before = jobs.length;
    jobs = jobs.filter((j) => (j.label || "") !== f.label);
    if (jobs.length === before) die(`no job labelled "${f.label}"`);
    save(jobs);
    console.log(JSON.stringify({ removed: f.label, remaining: jobs.length }, null, 2));
    break;
  }
  default:
    die('usage: list | add --label "X" --cron "0 7 * * *" --prompt "..." | remove --label "X"');
}
