#!/usr/bin/env node
// Core's Telegram bridge (OPTIONAL — Core runs fine without it). Zero-dep Node.
//
// Long-polls Telegram; each message from the AUTHORIZED chat is run through the Core agent
// (`pi`, same model/skills/extension as core.sh) and the answer is sent back. Handles text,
// voice notes (transcribed by the local model's audio encoder), and images/photos (Core sees
// them via the model's vision). Messages from any other chat are ignored (single-user lock).
// Because the bridge can send messages, it's also the channel the `notify` skill uses.
//
// Responsiveness: each job posts a status message ("🤔 Working on it…") immediately and keeps
// the typing indicator alive, then EDITS that message into the final answer.
//
// Scheduling lives in Core (the scheduler service), NOT here — this is just a messenger.
//
// Config (env): TELEGRAM_BOT_TOKEN (required), TELEGRAM_CHAT_ID (your chat — required to
// reply; until set, the bot logs incoming chat ids so you can find yours).
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID) : "";
const MODEL = process.env.CORE_MODEL ?? "local/local-model";
const EXT = "/app/.pi/extensions/context-saver.mjs";
const API = `https://api.telegram.org/bot${TOKEN}`;
// The local model also handles audio (the projector includes an audio encoder), so voice
// notes are transcribed by the main model — no separate STT service.
const LLM_URL = process.env.LLM_URL ?? "http://llm:8080/v1/chat/completions";

const log = (...a) => console.log("[bot]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- conversational session continuity ----
// Each chat is ONE persistent conversation, resumed by a STABLE pi session id so it survives
// bot restarts — matching what you see in the Telegram app, where the old messages are right
// there. It continues until you send /new (or /reset), which deletes the session so the next
// message starts fresh. Size stays bounded by pi's auto-compaction. Uses pi's default session
// dir (cwd = /app → project "--app--"); no custom dir. Scheduled/one-shot runs are stateless.
const SESSION_DIR = "/app/.pi/sessions/--app--";
const sessionIdFor = (chatId) => `core-tg-${chatId}`;
// Delete a chat's session file(s) so the next message starts a fresh conversation.
function resetSession(chatId) {
  const id = sessionIdFor(chatId);
  let n = 0;
  try {
    for (const f of readdirSync(SESSION_DIR)) {
      if (f === `${id}.jsonl` || f.endsWith(`_${id}.jsonl`)) { rmSync(`${SESSION_DIR}/${f}`, { force: true }); n++; }
    }
  } catch { /* dir may not exist yet — nothing to reset */ }
  return n;
}

if (!TOKEN) {
  log("TELEGRAM_BOT_TOKEN not set — bridge disabled. Set it in .env to enable the phone bridge.");
  process.exit(0);
}

// ---- Telegram helpers ----
async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return res.json();
}

// Send a message, return its message_id (for later editing).
async function sendMsg(chatId, text) {
  try {
    const r = await tg("sendMessage", { chat_id: chatId, text: (text || "(no output)").slice(0, 4096) });
    return r?.result?.message_id;
  } catch (e) {
    log("sendMsg error:", e.message);
    return undefined;
  }
}

// Edit a message (falls back to a fresh send if we have no message_id).
async function editMsg(chatId, id, text) {
  if (!id) return void (await send(chatId, text));
  try { await tg("editMessageText", { chat_id: chatId, message_id: id, text: (text || "(no output)").slice(0, 4096) }); }
  catch (e) { log("edit error:", e.message); }
}

// Plain send, chunked to Telegram's 4096-char limit.
async function send(chatId, text) {
  const t = text || "(no output)";
  for (let i = 0; i < t.length; i += 4000) {
    try { await tg("sendMessage", { chat_id: chatId, text: t.slice(i, i + 4000) }); }
    catch (e) { log("send error:", e.message); }
  }
}

// Turn the status message into the answer; spill overflow to follow-up messages.
async function editOrSend(chatId, id, text) {
  text = text || "(no output)";
  if (!id || text.length <= 4096) return void (await editMsg(chatId, id, text));
  await editMsg(chatId, id, text.slice(0, 4096));
  for (let i = 4096; i < text.length; i += 4000) await send(chatId, text.slice(i, i + 4000));
}

// Keep the "typing…" indicator alive (Telegram's expires after ~5s). Returns a stop fn.
function keepTyping(chatId) {
  const ping = () => tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  ping();
  const iv = setInterval(ping, 4000);
  return () => clearInterval(iv);
}

// Download a Telegram file to /tmp, preserving its extension. Returns the path (or null).
async function downloadTgFile(fileId, base) {
  const gf = await (await fetch(`${API}/getFile?file_id=${fileId}`, { signal: AbortSignal.timeout(20000) })).json();
  const path = gf.result?.file_path;
  if (!path) { log(`getFile: no path${gf.ok === false ? ` (${gf.description})` : ""}`); return null; }
  const dl = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${path}`, { signal: AbortSignal.timeout(30000) });
  const ext = path.includes(".") ? path.split(".").pop() : "bin";
  const out = `${base}.${ext}`;
  writeFileSync(out, Buffer.from(await dl.arrayBuffer()));
  return out;
}

// ---- agent run (streaming) ----
// Run a prompt through Core in JSON event mode and stream the assistant's answer out via
// callbacks, so the Telegram message can update live as text arrives. We forward only
// `text_delta` (the answer) — `thinking_delta` (reasoning) is deliberately ignored — plus
// tool start/end so the UI can show "🔧 …". imagePath (optional) is attached as a `@file`
// positional so the model sees the image. stdin ignored (an open stdin pipe makes pi hang
// forever); detached → own process group so the timeout can kill the whole tree.
function runAgent(prompt, imagePath, handlers = {}, sessionId) {
  return new Promise((resolve) => {
    const head = sessionId ? ["--mode", "json", "--session-id", sessionId] : ["--mode", "json"];
    const tail = ["--model", MODEL, "-e", EXT];
    const args = imagePath ? [...head, `@${imagePath}`, prompt, ...tail] : [...head, prompt, ...tail];
    const p = spawn("pi", args, { cwd: "/app", detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let err = "", buf = "", done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch { /* gone */ } }
      finish({ code: -1, err: "timed out after 180s" });
    }, 180000);
    p.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; } // ignore non-JSON / partial noise
        try {
          if (ev.type === "message_start" && ev.message?.role === "assistant") handlers.onAssistantStart?.();
          else if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") handlers.onDelta?.(ev.assistantMessageEvent.delta || "");
          else if (ev.type === "tool_execution_start") handlers.onTool?.(ev.toolName, ev.args);
          else if (ev.type === "tool_execution_end") handlers.onToolEnd?.();
        } catch { /* a handler throwing must not break the stream */ }
      }
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => finish({ code, err: err.trim() }));
    p.on("error", (e) => finish({ code: -1, err: String(e) }));
  });
}

// Build the transient "🔧 …" status line shown while a tool runs — capitalized and detailed
// (which command, which file). The trailing "…" is added by the renderer, not here.
function toolStatus(name, args = {}) {
  // No ellipsis on truncation — the renderer always appends "…", which reads as "in progress".
  const trim = (s, n = 56) => { s = String(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) : s; };
  const base = (p) => String(p).split("/").filter(Boolean).pop() || String(p);
  switch (name) {
    case "bash": {
      const cmd = args.command || "";
      const skill = cmd.match(/\/skills\/([^/]+)\//); // skills run via bash → name the skill
      if (skill) return `Running the ${skill[1]} skill`;
      return cmd ? `Running ${trim(cmd)}` : "Running a command";
    }
    case "read": return args.path ? `Reading ${base(args.path)}` : "Reading a file";
    case "write": return args.path ? `Writing ${base(args.path)}` : "Saving a file";
    case "edit": return args.path ? `Editing ${base(args.path)}` : "Editing a file";
    default: return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Working";
  }
}

function ffmpegTo16kWav(input, output) {
  return new Promise((res, rej) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-ar", "16000", "-ac", "1", output]);
    let fe = "";
    ff.stderr.on("data", (d) => (fe += d));
    ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}: ${fe.slice(0, 150)}`))));
    ff.on("error", rej);
  });
}

// Transcribe a Telegram voice/audio file with the local model (thinking off → text in content).
async function transcribe(fileId) {
  let oga, wav;
  try {
    oga = await downloadTgFile(fileId, `/tmp/v-${Date.now()}`);
    if (!oga) return null;
    wav = oga.replace(/\.[^.]+$/, ".wav");
    await ffmpegTo16kWav(oga, wav);
    const body = {
      model: "local-model", max_tokens: 512, temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: "user", content: [
        { type: "text", text: "Transcribe the spoken audio to text. Output ONLY the exact words spoken — no preamble, no quotation marks, no commentary." },
        { type: "input_audio", input_audio: { data: readFileSync(wav).toString("base64"), format: "wav" } },
      ] }],
    };
    const r = await fetch(LLM_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    if (!r.ok) { log(`transcribe: llm ${r.status} ${(await r.text()).slice(0, 150)}`); return null; }
    return (await r.json()).choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    log("transcribe error:", e?.message ?? e);
    return null;
  } finally {
    if (oga) rmSync(oga, { force: true });
    if (wav) rmSync(wav, { force: true });
  }
}

const IMAGE_PROMPT =
  "Look at this image. If it's a document, receipt, or screenshot, extract the key information; " +
  "otherwise describe what's in it and answer any implied question.";

// ---- queue: one job at a time (shared GPU) ----
let busy = false;
const queue = [];
async function enqueue(chatId, job) {
  queue.push({ chatId, ...job });
  if (busy) return;
  busy = true;
  while (queue.length) {
    const j = queue.shift();
    const stop = keepTyping(j.chatId);
    let statusId, imagePath;
    try {
      let prompt = j.prompt;
      if (j.voiceFileId) {
        statusId = await sendMsg(j.chatId, "🎤 Transcribing…");
        const heard = await transcribe(j.voiceFileId);
        if (!heard) { await editMsg(j.chatId, statusId, "🎤 Sorry — couldn't transcribe that. Try again, or send text."); continue; }
        log(`transcribed: ${heard.slice(0, 80)}`);
        await editMsg(j.chatId, statusId, `🎤 “${heard}”`); // heard echo stays visible
        statusId = await sendMsg(j.chatId, "🤔 Working on it…");
        prompt = heard;
      } else if (j.photoFileId) {
        statusId = await sendMsg(j.chatId, "🖼️ Looking at the image…");
        imagePath = await downloadTgFile(j.photoFileId, `/tmp/img-${Date.now()}`);
        if (!imagePath) { await editMsg(j.chatId, statusId, "🖼️ Sorry — couldn't fetch that image."); continue; }
        prompt = j.caption?.trim() || IMAGE_PROMPT;
      } else {
        statusId = await sendMsg(j.chatId, "🤔 Working on it…");
      }
      const t0 = process.hrtime.bigint();
      // Live: accumulate the current assistant message's text plus a transient tool line, and
      // edit the status message as it streams in (throttled to stay under Telegram's edit rate).
      let answer = "", tool = "", lastShown = "", lastEdit = 0;
      const view = () => {
        const t = answer.trimStart();
        const body = tool ? `${t ? t + "\n\n" : ""}🔧 ${tool}…` : t;
        return body || "🤔 Working on it…";
      };
      const render = async (force) => {
        const now = Date.now();
        // Throttle repaints: Telegram has no real token stream — each update is an
        // editMessageText call and is rate-limited, so we repaint at most every ~800ms
        // (smaller/more frequent chunks than before, still clear of 429s; a dropped edit just
        // merges into the next repaint). True per-token streaming isn't possible here.
        if (!force && now - lastEdit < 800) return;
        const text = view();
        if (text === lastShown) return;
        lastShown = text; lastEdit = now;
        await editMsg(j.chatId, statusId, text.length > 4096 ? text.slice(0, 4090) + "…" : text);
      };
      const sessionId = sessionIdFor(j.chatId); // resume this chat's conversation (bounded; see top)
      const r = await runAgent(prompt, imagePath, {
        onAssistantStart: () => { answer = ""; },         // show only the latest message's text
        onDelta: (d) => { answer += d; render(false); },
        onTool: (name, args) => { tool = toolStatus(name, args); render(true); },
        onToolEnd: () => { tool = ""; },
      }, sessionId);
      const secs = Number(process.hrtime.bigint() - t0) / 1e9;
      const reply = answer.trim() || (r.code === 0 ? "(no output)" : `⚠️ agent error: ${r.err || "failed"}`);
      log(`run done in ${secs.toFixed(0)}s: exit=${r.code} out=${reply.length}ch${r.err ? ` err=${r.err.slice(0, 80)}` : ""}`);
      await editOrSend(j.chatId, statusId, reply); // final, clean answer (handles >4096 chunking)
      log(`replied (${reply.length}ch)`);
    } catch (e) {
      log(`job error: ${e?.message ?? e}`);
      try { await editOrSend(j.chatId, statusId, `⚠️ ${e?.message ?? e}`); } catch { /* ignore */ }
    } finally {
      stop();
      if (imagePath) rmSync(imagePath, { force: true });
    }
  }
  busy = false;
}

// ---- long-poll ----
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
        // Reset conversational context on demand (next message starts a fresh session).
        if (m.text && /^\/(new|reset)\b/i.test(m.text.trim())) {
          const n = resetSession(chatId);
          log(`session reset by user (${n} file(s) deleted)`);
          sendMsg(chatId, "🆕 Fresh start — cleared this conversation.").catch(() => {});
          continue;
        }
        if (m.voice || m.audio) { log("voice message"); enqueue(chatId, { voiceFileId: (m.voice || m.audio).file_id }); continue; }
        const imgDoc = m.document && m.document.mime_type?.startsWith("image/");
        if (m.photo?.length || imgDoc) {
          log("image message");
          const fileId = m.photo?.length ? m.photo[m.photo.length - 1].file_id : m.document.file_id; // largest photo size
          enqueue(chatId, { photoFileId: fileId, caption: m.caption });
          continue;
        }
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
