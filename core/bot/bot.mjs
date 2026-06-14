#!/usr/bin/env node
// Core's Telegram bridge (OPTIONAL — Core runs fine without it). Zero-dep Node.
//
// Long-polls Telegram; each text message from the AUTHORIZED chat is run through the
// Core agent (`pi -p …`, same model/skills/extension as core.sh) and the answer is sent
// back. Messages from any other chat are ignored (hard single-user lock). Because the
// bridge can send messages, it's also the channel the `notify` skill uses.
//
// Scheduling lives in Core (the scheduler service), NOT here — this is just a messenger.
//
// Config (env): TELEGRAM_BOT_TOKEN (required), TELEGRAM_CHAT_ID (your chat — required to
// reply; until set, the bot logs incoming chat ids so you can find yours).
import { spawn } from "node:child_process";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID) : "";
const MODEL = process.env.CORE_MODEL ?? "local/local-model";
const EXT = "/app/.pi/extensions/context-saver.mjs";
const API = `https://api.telegram.org/bot${TOKEN}`;

const log = (...a) => console.log("[bot]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!TOKEN) {
  log("TELEGRAM_BOT_TOKEN not set — bridge disabled. Set it in .env to enable the phone bridge.");
  process.exit(0);
}

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return res.json();
}

async function send(chatId, text) {
  const t = text || "(no output)";
  for (let i = 0; i < t.length; i += 4000) {
    try { await tg("sendMessage", { chat_id: chatId, text: t.slice(i, i + 4000) }); }
    catch (e) { log("send error:", e.message); }
  }
}

function runAgent(prompt) {
  return new Promise((resolve) => {
    // detached so pi leads its own process group — lets us kill the whole tree (pi + any
    // tool subprocesses) on timeout, so a hung/runaway run can never wedge the queue.
    // stdin MUST be ignored: with an open stdin pipe, `pi -p` runs the agent but then
    // waits on stdin forever and never exits (no reply). detached → own group for timeout-kill.
    const p = spawn("pi", ["-p", prompt, "--model", MODEL, "-e", EXT], { cwd: "/app", detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch { /* gone */ } }
      finish({ code: -1, out: out.trim(), err: "timed out after 180s" });
    }, 180000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => finish({ code, out: out.trim(), err: err.trim() }));
    p.on("error", (e) => finish({ code: -1, out: "", err: String(e) }));
  });
}

// Serialize agent runs (one GPU) — queue prompts and process one at a time.
let busy = false;
const queue = [];
async function enqueue(chatId, prompt) {
  queue.push({ chatId, prompt });
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      tg("sendChatAction", { chat_id: job.chatId, action: "typing" }).catch(() => {});
      const t0 = process.hrtime.bigint();
      const r = await runAgent(job.prompt);
      const secs = Number(process.hrtime.bigint() - t0) / 1e9;
      log(`run done in ${secs.toFixed(0)}s: exit=${r.code} out=${r.out.length}ch${r.err ? ` err=${r.err.slice(0, 80)}` : ""}`);
      const reply = r.out || (r.code === 0 ? "(no output)" : `⚠️ agent error: ${r.err || "failed"}`);
      await send(job.chatId, reply);
      log(`replied (${reply.length}ch)`);
    } catch (e) {
      log(`job error: ${e?.message ?? e}`);
      try { await send(job.chatId, `⚠️ ${e?.message ?? e}`); } catch { /* ignore */ }
    }
  }
  busy = false;
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`, { signal: AbortSignal.timeout(40000) });
      const j = await res.json();
      for (const u of j.result ?? []) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m?.chat) continue;
        const chatId = String(m.chat.id);
        if (!ALLOWED) { log(`message from chat ${chatId} — set TELEGRAM_CHAT_ID=${chatId} in .env, then restart the bot.`); continue; }
        if (chatId !== ALLOWED) { log(`ignoring chat ${chatId} (not the authorized chat).`); continue; }
        if (m.voice || m.audio) { await send(chatId, "🎤 Voice messages aren't supported yet — send text for now."); continue; }
        if (m.text) { log(`prompt: ${m.text.slice(0, 80)}`); enqueue(chatId, m.text); }
      }
    } catch (e) {
      log("poll error:", e.message);
      await sleep(3000);
    }
  }
}

log(`starting (model=${MODEL}, chat=${ALLOWED || "UNSET"})`);
if (ALLOWED) send(ALLOWED, "✅ Core is online.").catch(() => {});
poll();
