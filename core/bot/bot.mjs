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
import { writeFileSync, readFileSync, rmSync } from "node:fs";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID) : "";
const MODEL = process.env.CORE_MODEL ?? "local/local-model";
const EXT = "/app/.pi/extensions/context-saver.mjs";
const API = `https://api.telegram.org/bot${TOKEN}`;
// The local model also handles audio (the vision projector includes an audio encoder),
// so voice notes are transcribed by the main model — no separate STT service.
const LLM_URL = process.env.LLM_URL ?? "http://llm:8080/v1/chat/completions";

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

// Transcribe a Telegram voice/audio file with the local model (its projector includes an
// audio encoder). Download the OGG, convert to 16 kHz mono WAV via ffmpeg, send to the llm.
async function transcribe(fileId) {
  try {
    const gf = await (await fetch(`${API}/getFile?file_id=${fileId}`, { signal: AbortSignal.timeout(20000) })).json();
    const path = gf.result?.file_path;
    log(`transcribe: getFile path=${path || "NONE"}${gf.ok === false ? ` (${gf.description})` : ""}`);
    if (!path) return null;
    const dl = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${path}`, { signal: AbortSignal.timeout(30000) });
    const oga = `/tmp/v-${Date.now()}.oga`, wav = oga.replace(".oga", ".wav");
    writeFileSync(oga, Buffer.from(await dl.arrayBuffer()));
    log(`transcribe: downloaded ${readFileSync(oga).length}b -> ${oga}`);
    await new Promise((res, rej) => {
      const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", oga, "-ar", "16000", "-ac", "1", wav]);
      let fe = "";
      ff.stderr.on("data", (d) => (fe += d));
      ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}: ${fe.slice(0, 200)}`))));
      ff.on("error", rej);
    });
    const b64 = readFileSync(wav).toString("base64");
    log(`transcribe: wav ${readFileSync(wav).length}b`);
    rmSync(oga, { force: true }); rmSync(wav, { force: true });
    const body = {
      model: "local-model", max_tokens: 512, temperature: 0,
      // Disable thinking: transcription needs none, and with it on the model spends its
      // output on reasoning_content and leaves content EMPTY. This puts the text in content.
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: "user", content: [
        { type: "text", text: "Transcribe the spoken audio to text. Output ONLY the exact words spoken — no preamble, no quotation marks, no commentary." },
        { type: "input_audio", input_audio: { data: b64, format: "wav" } },
      ] }],
    };
    const r = await fetch(LLM_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    if (!r.ok) { log(`transcribe: llm ${r.status} ${(await r.text()).slice(0, 150)}`); return null; }
    const txt = (await r.json()).choices?.[0]?.message?.content?.trim() || null;
    log(`transcribe: llm 200, transcript=${txt ? txt.length + "ch" : "EMPTY"}`);
    return txt;
  } catch (e) {
    log("transcribe error:", e?.message ?? e);
    return null;
  }
}

// Serialize agent runs (one GPU) — queue jobs and process one at a time.
// A job is { prompt } (text) or { voiceFileId } (a voice note to transcribe first).
let busy = false;
const queue = [];
async function enqueue(chatId, job) {
  queue.push({ chatId, ...job });
  if (busy) return;
  busy = true;
  while (queue.length) {
    const j = queue.shift();
    try {
      let prompt = j.prompt;
      if (j.voiceFileId) {
        const heard = await transcribe(j.voiceFileId);
        if (!heard) { await send(j.chatId, "🎤 Sorry — couldn't transcribe that. Try again, or send text."); continue; }
        log(`transcribed: ${heard.slice(0, 80)}`);
        await send(j.chatId, `🎤 “${heard}”`); // echo what was heard, then act on it
        prompt = heard;
      }
      tg("sendChatAction", { chat_id: j.chatId, action: "typing" }).catch(() => {});
      const t0 = process.hrtime.bigint();
      const r = await runAgent(prompt);
      const secs = Number(process.hrtime.bigint() - t0) / 1e9;
      log(`run done in ${secs.toFixed(0)}s: exit=${r.code} out=${r.out.length}ch${r.err ? ` err=${r.err.slice(0, 80)}` : ""}`);
      const reply = r.out || (r.code === 0 ? "(no output)" : `⚠️ agent error: ${r.err || "failed"}`);
      await send(j.chatId, reply);
      log(`replied (${reply.length}ch)`);
    } catch (e) {
      log(`job error: ${e?.message ?? e}`);
      try { await send(j.chatId, `⚠️ ${e?.message ?? e}`); } catch { /* ignore */ }
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
        if (m.voice || m.audio) { log("voice message"); enqueue(chatId, { voiceFileId: (m.voice || m.audio).file_id }); continue; }
        if (m.text) { log(`prompt: ${m.text.slice(0, 80)}`); enqueue(chatId, { prompt: m.text }); }
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
