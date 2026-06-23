#!/usr/bin/env node
// Core's Telegram bridge (OPTIONAL — Core runs fine without it). Zero-dep Node.
//
// Long-polls Telegram; each message from the AUTHORIZED chat is run through the Core agent
// (`pi`, same model/skills/extension as core.sh) and the answer is sent back. Handles text,
// voice notes (transcribed via the optional VOICE_* endpoint), and images/photos (Core sees
// them via the model's vision). Messages from any other chat are ignored (single-user lock).
// Because the bridge can send messages, it's also the channel the `notify` skill uses.
//
// Responsiveness: each job posts a status message ("💭 Thinking…") immediately and keeps
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
// Core's context extensions — one dedicated concern each (spill, loop guard, memory). Loaded with
// one -e apiece (pi's arg parser accepts repeated -e). Compaction stays native to pi.
const EXT_DIR = "/app/.pi/extensions";
const EXT_ARGS = ["spill", "loop-guard", "memory"].flatMap((n) => ["-e", `${EXT_DIR}/${n}.mjs`]);
// Appended to Core's system prompt for bot runs only (the CLI stays plain markdown): the reply
// is rendered in Telegram, which supports a small HTML subset. Keep this strict — invalid HTML
// makes Telegram reject the message (we then fall back to plain, showing raw tags).
const TG_FORMAT =
  "Your reply is the ONLY thing the user sees — it must contain just the final answer addressed " +
  "to them. NEVER put your reasoning, planning, self-talk, or step-by-step thinking in the reply " +
  "(no \"The user wants…\", \"I should…\", \"Wait…\", \"Plan:\", \"Command:\"); keep all of that in " +
  "your private reasoning. " +
  "OUTPUT FORMAT: your reply is shown in Telegram. Format it with ONLY these HTML tags: " +
  "<b>bold</b>, <i>italic</i>, <u>underline</u>, <s>strike</s>, <code>inline code</code>, " +
  "<pre>code block</pre>, <a href=\"url\">link</a>. Do NOT use Markdown (no **, ##, backticks, " +
  "tables). Escape literal <, >, & as &lt; &gt; &amp; in normal text. No other tags (no <h1>, " +
  "<ul>, <li>, <p>, <br>). For lists use lines starting with •. Keep replies concise.";
const API = `https://api.telegram.org/bot${TOKEN}`;
// Voice notes are transcribed by an OPTIONAL, separate OpenAI-compatible endpoint — set
// VOICE_LLM_URL (full /chat/completions URL) + VOICE_MODEL (and VOICE_API_KEY if it needs a
// key) to any audio-capable model. If unset, voice notes are politely skipped. This keeps
// Core model-agnostic: the main text model doesn't have to handle audio.
const VOICE_URL = process.env.VOICE_LLM_URL ?? "";
const VOICE_MODEL = process.env.VOICE_MODEL ?? "";
const VOICE_API_KEY = process.env.VOICE_API_KEY ?? "";

// Tunables. Telegram caps a message at 4096 chars; we slice a little below that and only
// break on a newline once past TG_CHUNK_MIN_BREAK, so an HTML tag or word is never cut.
const TG_MSG_LIMIT = 4096;            // Telegram's hard per-message character limit
const TG_CHUNK = 4000;                // safe slice size when splitting a long reply
const TG_CHUNK_MIN_BREAK = 2000;      // below this, force a hard cut instead of hunting for "\n"
const AGENT_TIMEOUT_MS = 180000;      // kill a Core run that hasn't finished in 3 min
const TYPING_PING_MS = 4000;          // re-send "typing…" before Telegram's ~5s indicator expires
const EDIT_THROTTLE_MS = 800;         // min gap between live status edits (Telegram edit rate)
const POLL_WAIT_SECS = 30;            // getUpdates long-poll hold time
const POLL_FETCH_TIMEOUT_MS = 40000;  // fetch abort > long-poll hold, so the hold can complete

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

// ---- model selection (switchable from Telegram via /model) ----
// The switchable list is the single source of truth in models.json (pi's config dir). The id
// we pass to `pi --model` is "<provider>/<model.id>" (e.g. api/comma-soft/gemma4-31b) — the
// same provider/model form pi uses everywhere.
const MODELS_JSON = "/app/.pi/models.json";

// models.json is authored with // comments and trailing-comment lines, which JSON.parse
// rejects. Strip line comments in a string-aware pass so the "//" inside URLs (http://…)
// is preserved.
function stripJsonComments(src) {
  let out = "", inStr = false, quote = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += src[++i] ?? ""; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    out += c;
  }
  return out;
}

// Flatten models.json → [{ id: "provider/modelId", name }]. Falls back to just the local
// model if the file can't be read/parsed, so /model never crashes the bot.
function loadModels() {
  try {
    const cfg = JSON.parse(stripJsonComments(readFileSync(MODELS_JSON, "utf8")));
    const out = [];
    for (const [provider, p] of Object.entries(cfg.providers ?? {})) {
      for (const m of p.models ?? []) out.push({ id: `${provider}/${m.id}`, name: m.name || m.id });
    }
    if (out.length) return out;
  } catch (e) {
    log("loadModels error:", e?.message ?? e);
  }
  return [];
}

// pi's own default model (data/pi/settings.json: defaultProvider + defaultModel). Used as the
// bot's starting model so the reply path matches what pi would pick on its own.
const SETTINGS_JSON = "/app/.pi/settings.json";
function defaultModelId() {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_JSON, "utf8"));
    if (s.defaultProvider && s.defaultModel) return `${s.defaultProvider}/${s.defaultModel}`;
  } catch { /* fall through to first configured model */ }
  return MODELS[0]?.id ?? "";
}

const MODELS = loadModels();
// Each bot start begins on pi's default model, just like the CLI — a /model switch lasts only
// for the running process and resets on restart. No persistence.
let activeModel = process.env.CORE_MODEL ?? defaultModelId();
const modelName = (id) => MODELS.find((m) => m.id === id)?.name ?? id;
function setModel(id) { activeModel = id; }

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
    const r = await tg("sendMessage", { chat_id: chatId, text: (text || "(no output)").slice(0, TG_MSG_LIMIT) });
    return r?.result?.message_id;
  } catch (e) {
    log("sendMsg error:", e.message);
    return undefined;
  }
}

// Edit a message (falls back to a fresh send if we have no message_id). `parseMode` (e.g.
// "HTML") is optional; if an HTML edit is rejected (bad markup), we retry once as plain text
// so a converter slip never leaves the user staring at a stuck "Working…" message.
async function editMsg(chatId, id, text, parseMode) {
  if (!id) return void (await send(chatId, text));
  const t = (text || "(no output)").slice(0, TG_MSG_LIMIT);
  const payload = { chat_id: chatId, message_id: id, text: t };
  if (parseMode) payload.parse_mode = parseMode;
  try { await tg("editMessageText", payload); }
  catch (e) {
    if (parseMode) {
      try { return void (await tg("editMessageText", { chat_id: chatId, message_id: id, text: t })); }
      catch (e2) { return void log("edit error (plain retry):", e2.message); }
    }
    log("edit error:", e.message);
  }
}

// Plain send, chunked to Telegram's 4096-char limit.
async function send(chatId, text) {
  const t = text || "(no output)";
  for (let i = 0; i < t.length; i += TG_CHUNK) {
    try { await tg("sendMessage", { chat_id: chatId, text: t.slice(i, i + TG_CHUNK) }); }
    catch (e) { log("send error:", e.message); }
  }
}

// Reasoning models sometimes leak chain-of-thought into the answer wrapped in <think>…</think>
// (the system prompt asks them not to; this is the belt-and-braces). Drop those blocks — and a
// dangling </think> with no opener — so the user never sees raw reasoning. Plain prose reasoning
// without tags can't be detected here; the system prompt is the primary guard against that.
function stripThinking(s) {
  let out = String(s).replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (/<\/think>/i.test(out) && !/<think>/i.test(out)) out = out.replace(/^[\s\S]*?<\/think>/i, "");
  return out.replace(/<\/?think>/gi, "").trim();
}

// Split a long reply into Telegram-sized pieces on a newline boundary (so an HTML tag or
// word is never cut in two); below TG_CHUNK_MIN_BREAK we force a hard cut instead.
function chunkText(text) {
  const pieces = [];
  let rest = text || "(no output)";
  while (rest.length > TG_CHUNK) {
    let cut = rest.lastIndexOf("\n", TG_CHUNK);
    if (cut < TG_CHUNK_MIN_BREAK) cut = TG_CHUNK;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  pieces.push(rest);
  return pieces;
}

// Turn the status message into the final answer; spill overflow to follow-up messages.
// Core already formats its reply as Telegram HTML (see the bot's appended system prompt), so
// `parseMode` is just passed through — no conversion here. editMsg falls back to plain on
// an HTML error.
async function editOrSend(chatId, id, text, parseMode) {
  const pieces = chunkText(text);
  await editMsg(chatId, id, pieces[0], parseMode);
  for (let i = 1; i < pieces.length; i++) {
    try { await tg("sendMessage", { chat_id: chatId, text: pieces[i], ...(parseMode ? { parse_mode: parseMode } : {}) }); }
    catch (e) { log("send error:", e.message); }
  }
}

// Post a reply as its OWN message(s) (not an edit), chunked like editOrSend. Used when the
// activity trail is kept and the answer goes below it. Retries once as plain on an HTML error.
async function sendHtml(chatId, text, parseMode) {
  for (const piece of chunkText(text)) {
    try { await tg("sendMessage", { chat_id: chatId, text: piece, ...(parseMode ? { parse_mode: parseMode } : {}) }); }
    catch (e) {
      if (parseMode) {
        try { await tg("sendMessage", { chat_id: chatId, text: piece }); continue; }
        catch (e2) { log("send error (plain retry):", e2.message); continue; }
      }
      log("send error:", e.message);
    }
  }
}

// ---- model picker (tap-to-switch inline keyboard for /model) ----
// One button per model from models.json; the active one is marked ●. callback_data carries
// the model's index (kept well under Telegram's 64-byte limit); the tap is handled in poll().
function modelPickerMarkup() {
  return {
    inline_keyboard: MODELS.map((m, i) => [
      { text: `${m.id === activeModel ? "● " : "○ "}${m.name}`, callback_data: `m:${i}` },
    ]),
  };
}
async function sendModelPicker(chatId) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: `🧠 Model — current: ${modelName(activeModel)}\nTap to switch:`,
    reply_markup: modelPickerMarkup(),
  });
}

// Keep the "typing…" indicator alive (Telegram's expires after ~5s). Returns a stop fn.
function keepTyping(chatId) {
  const ping = () => tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  ping();
  const iv = setInterval(ping, TYPING_PING_MS);
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
// callbacks, so the Telegram message can update live as text arrives. We forward `text_delta`
// (the answer) and `thinking_delta` (reasoning, shown collapsed in the live process log) plus
// tool start/end so the UI can show the trail. imagePath (optional) is attached as a `@file`
// positional so the model sees the image. stdin ignored (an open stdin pipe makes pi hang
// forever); detached → own process group so the timeout can kill the whole tree.
function runAgent(prompt, imagePath, handlers = {}, sessionId) {
  return new Promise((resolve) => {
    const head = sessionId ? ["--mode", "json", "--session-id", sessionId] : ["--mode", "json"];
    const tail = [...(activeModel ? ["--model", activeModel] : []), ...EXT_ARGS, "--append-system-prompt", TG_FORMAT];
    const args = imagePath ? [...head, `@${imagePath}`, prompt, ...tail] : [...head, prompt, ...tail];
    const p = spawn("pi", args, { cwd: "/app", detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let err = "", buf = "", done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch { /* gone */ } }
      finish({ code: -1, err: `timed out after ${AGENT_TIMEOUT_MS / 1000}s` });
    }, AGENT_TIMEOUT_MS);
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
          else if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "thinking_delta") handlers.onThinking?.(ev.assistantMessageEvent.delta || "");
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
  const skillOf = (s) => String(s).match(/\/skills\/([^/]+)\//)?.[1] ?? null; // .../skills/<name>/...
  switch (name) {
    case "bash": {
      const cmd = args.command || "";
      const skill = skillOf(cmd); // skills run via bash → name the skill
      if (skill) return `Running the ${skill} skill`;
      return cmd ? `Running ${trim(cmd)}` : "Running a command";
    }
    case "read": {
      // A skill is loaded by reading its SKILL.md — name the skill, not the file.
      const skill = skillOf(args.path);
      if (skill && /SKILL\.md$/i.test(args.path)) return `Loading the ${skill} skill`;
      return args.path ? `Reading ${base(args.path)}` : "Reading a file";
    }
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

// Transcribe a Telegram voice/audio file via the optional VOICE_* endpoint (OpenAI-compatible
// chat with an input_audio part). Returns null on any failure → caller shows a fallback.
async function transcribe(fileId) {
  let oga, wav;
  try {
    oga = await downloadTgFile(fileId, `/tmp/v-${Date.now()}`);
    if (!oga) return null;
    wav = oga.replace(/\.[^.]+$/, ".wav");
    await ffmpegTo16kWav(oga, wav);
    const body = {
      model: VOICE_MODEL, max_tokens: 512, temperature: 0,
      messages: [{ role: "user", content: [
        { type: "text", text: "Transcribe the spoken audio to text. Output ONLY the exact words spoken — no preamble, no quotation marks, no commentary." },
        { type: "input_audio", input_audio: { data: readFileSync(wav).toString("base64"), format: "wav" } },
      ] }],
    };
    const headers = { "Content-Type": "application/json" };
    if (VOICE_API_KEY) headers.Authorization = `Bearer ${VOICE_API_KEY}`;
    const r = await fetch(VOICE_URL, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    if (!r.ok) { log(`transcribe: ${r.status} ${(await r.text()).slice(0, 150)}`); return null; }
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
        if (!VOICE_URL) { await sendMsg(j.chatId, "🎤 Voice transcription isn't configured (set VOICE_LLM_URL). Send text instead."); continue; }
        statusId = await sendMsg(j.chatId, "🎤 Transcribing…");
        const heard = await transcribe(j.voiceFileId);
        if (!heard) { await editMsg(j.chatId, statusId, "🎤 Sorry — couldn't transcribe that. Try again, or send text."); continue; }
        log(`transcribed: ${heard.slice(0, 80)}`);
        await editMsg(j.chatId, statusId, `🎤 “${heard}”`); // heard echo stays visible
        statusId = await sendMsg(j.chatId, "💭 Thinking…");
        prompt = heard;
      } else if (j.photoFileId) {
        statusId = await sendMsg(j.chatId, "🖼️ Looking at the image…");
        imagePath = await downloadTgFile(j.photoFileId, `/tmp/img-${Date.now()}`);
        if (!imagePath) { await editMsg(j.chatId, statusId, "🖼️ Sorry — couldn't fetch that image."); continue; }
        prompt = j.caption?.trim() || IMAGE_PROMPT;
      } else {
        statusId = await sendMsg(j.chatId, "💭 Thinking…");
      }
      const t0 = process.hrtime.bigint();
      const elapsed = () => Math.round(Number(process.hrtime.bigint() - t0) / 1e9);
      // Live: ONE status message showing the activity TRAIL — each finished tool stays as a
      // "✓ …" line, with the current phase ("💭 Thinking", "🔧 <tool>", "✍️ Writing") plus
      // elapsed time on the last line. So you watch Core work step by step. The answer is
      // accumulated separately; Core formats it as Telegram HTML itself. On completion the
      // trail collapses to a summary that STAYS above the answer (sent as its own message).
      const MAX_TRAIL = 8;          // visible "✓ …" lines while live (bounds message length)
      let answer = "", phase = "thinking", currentTool = null;
      const steps = [];             // completed step labels, e.g. "Reading config.json"
      let lastShown = "", lastEdit = 0;
      // Build the trail lines, capped to the last `max` (older ones folded into a count).
      const trail = (max) => steps.length <= max ? steps.map((s) => `✓ ${s}`)
        : [`… (+${steps.length - max} earlier)`, ...steps.slice(-max).map((s) => `✓ ${s}`)];
      const liveBody = () => {
        const cur = currentTool ? `🔧 ${currentTool}…`
          : phase === "writing" ? "✍️ Writing the reply…"
          : "💭 Thinking…";
        return [...trail(MAX_TRAIL), `${cur}  ·  ${elapsed()}s`].join("\n");
      };
      const render = async (force) => {
        const now = Date.now();
        // Throttle repaints to stay under Telegram's edit rate (~800ms).
        if (!force && now - lastEdit < EDIT_THROTTLE_MS) return;
        const body = liveBody();
        if (body === lastShown) return;
        lastShown = body; lastEdit = now;
        await editMsg(j.chatId, statusId, body); // plain text — trail lines may contain < > &
      };
      const sessionId = sessionIdFor(j.chatId); // resume this chat's conversation (bounded; see top)
      const r = await runAgent(prompt, imagePath, {
        onAssistantStart: () => { answer = ""; },
        onThinking: () => { if (!currentTool) phase = "thinking"; render(false); },
        onDelta: (d) => { answer += d; phase = "writing"; render(false); },
        onTool: (name, args) => { currentTool = toolStatus(name, args); render(true); },
        onToolEnd: () => { if (currentTool) steps.push(currentTool); currentTool = null; phase = "thinking"; render(true); },
      }, sessionId);
      const secs = Number(process.hrtime.bigint() - t0) / 1e9;
      const reply = stripThinking(answer) || (r.code === 0 ? "(no output)" : `⚠️ agent error: ${r.err || "failed"}`);
      log(`run done in ${secs.toFixed(0)}s: exit=${r.code} out=${reply.length}ch steps=${steps.length}${r.err ? ` err=${r.err.slice(0, 80)}` : ""}`);
      if (steps.length) {
        // Keep the trail: collapse the status message to a summary, then post the answer below.
        const summary = [...trail(12), `⏱️ Took ${secs.toFixed(0)}s`].join("\n");
        await editMsg(j.chatId, statusId, summary);
        await sendHtml(j.chatId, reply, "HTML");
      } else {
        // No tools ran — just a clean single answer message (no empty trail).
        await editOrSend(j.chatId, statusId, reply, "HTML");
      }
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
      const res = await fetch(`${API}/getUpdates?timeout=${POLL_WAIT_SECS}&offset=${offset}`, { signal: AbortSignal.timeout(POLL_FETCH_TIMEOUT_MS) });
      const j = await res.json();
      for (const u of j.result ?? []) {
        offset = u.update_id + 1;
        // A model-picker button tap arrives as a callback_query, not a message.
        const cq = u.callback_query;
        if (cq) {
          const cqChat = cq.message?.chat ? String(cq.message.chat.id) : "";
          if (ALLOWED && cqChat === ALLOWED && cq.data?.startsWith("m:")) {
            const chosen = MODELS[Number(cq.data.slice(2))];
            if (chosen) {
              setModel(chosen.id);
              log(`model switched to ${chosen.id}`);
              await tg("editMessageText", {
                chat_id: cqChat, message_id: cq.message.message_id,
                text: `🧠 Model — current: ${chosen.name}\n✅ Switched. Tap another to change.`,
                reply_markup: modelPickerMarkup(),
              });
            }
            await tg("answerCallbackQuery", { callback_query_id: cq.id, text: chosen ? `Switched to ${chosen.name}` : "Unknown model" });
          } else {
            await tg("answerCallbackQuery", { callback_query_id: cq.id });
          }
          continue;
        }
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
        // Show the tap-to-switch model picker.
        if (m.text && /^\/models?\b/i.test(m.text.trim())) {
          log("model picker requested");
          sendModelPicker(chatId).catch((e) => log("picker error:", e?.message ?? e));
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

log(`starting (model=${activeModel}, chat=${ALLOWED || "UNSET"})`);
if (ALLOWED) send(ALLOWED, "✅ Core is online.").catch(() => {});
poll();
