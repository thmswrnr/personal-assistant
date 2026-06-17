#!/usr/bin/env node
// Alan (Comma-Soft) chat client for Core. Talks to the Alan backend's chat API
// (https://dev.alan.de/api/v1) — an agentic, optionally RAG-grounded assistant.
// The OpenAI-compatible /oai endpoints are not used (currently broken); we drive
// the native /chats/ streaming endpoint instead.
//
// Auth: a personal API key sent as `Authorization: Bearer <key>`. Read from
//   $ALAN_API_KEY or the file /app/secrets/alan_api_key (whitespace-trimmed).
//
// Usage:
//   node alan.mjs ask "<prompt>" [--model <name>|--instant|--thinking|--gpt]
//                                [--system "<prompt>"] [--reasoning]
//   node alan.mjs reply <chat_id> <prev_msg_id> "<prompt>" [same flags as ask]
//   node alan.mjs models                 # list available chat models
//
// `ask` answers in a fresh, UI-hidden chat and prints a footer
//   "— chat <chat_id> · msg <message_id>" to stderr so you can `reply` to continue.

import { readFileSync } from "node:fs";

const BASE = (process.env.ALAN_API_BASE || "https://dev.alan.de/api/v1").replace(/\/$/, "");

// Friendly aliases → real model names (see `models`). Default favours a fast reply.
const MODEL_ALIASES = {
  instant: "comma-soft/gemma4-31b-instant",
  thinking: "comma-soft/gemma4-31b",
  gpt: "openai/gpt-5.4",
};
const DEFAULT_MODEL = MODEL_ALIASES.instant;

function die(m) { console.error(`alan: ${m}`); process.exit(1); }

function apiKey() {
  if (process.env.ALAN_API_KEY) return process.env.ALAN_API_KEY.trim();
  try { return readFileSync("/app/secrets/alan_api_key", "utf8").trim() || null; } catch { return null; }
}

function flag(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
function has(name) { return process.argv.includes(`--${name}`); }

function chosenModel() {
  for (const [alias, name] of Object.entries(MODEL_ALIASES)) if (has(alias)) return name;
  return flag("model", DEFAULT_MODEL);
}

async function api(path, { method = "GET", body } = {}) {
  const key = apiKey();
  if (!key) die("no API key — set $ALAN_API_KEY or put it in /app/secrets/alan_api_key");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

// Drive a chat SSE stream to completion, printing assistant tokens as they arrive.
// Returns { chatId, messageId } of the assistant answer for follow-ups.
async function streamChat(res) {
  if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
    let detail = "";
    try { detail = JSON.stringify(await res.json()); } catch {}
    die(`HTTP ${res.status} ${detail}`);
  }
  if (!res.body) die(`HTTP ${res.status} — empty response`);

  const showReasoning = has("reasoning");
  let answer = "";
  let chatId = null, messageId = null;
  let printedAny = false, inReasoning = false;

  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trimEnd();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }

      switch (ev.kind) {
        case "chat":
          chatId = ev.chat?.resource_id || chatId;
          break;
        case "tokens":
          messageId = ev.message_id || messageId;
          if (showReasoning && ev.reasoning_tokens) {
            if (!inReasoning) { process.stdout.write("\x1b[2m"); inReasoning = true; } // dim
            process.stdout.write(ev.reasoning_tokens);
          }
          if (ev.tokens) {
            if (inReasoning) { process.stdout.write("\x1b[0m\n"); inReasoning = false; }
            process.stdout.write(ev.tokens);
            answer += ev.tokens;
            printedAny = true;
          }
          break;
        case "message":
          // Final, authoritative copy of the assistant turn.
          if (ev.message?.role === "assistant" && ev.message?.state === "Done") {
            messageId = ev.message.resource_id || messageId;
            if (ev.message.content) answer = ev.message.content; // trust final content
          }
          break;
        case "error":
          if (inReasoning) process.stdout.write("\x1b[0m");
          die(ev.message || ev.detail || "stream error");
      }
    }
  }
  if (inReasoning) process.stdout.write("\x1b[0m");
  if (printedAny) process.stdout.write("\n");
  else if (answer) console.log(answer);
  else die("no answer returned");

  if (chatId && messageId) console.error(`\n— chat ${chatId} · msg ${messageId}`);
  return { chatId, messageId, answer };
}

function buildSettings() {
  const settings = { model: chosenModel() };
  const sys = flag("system");
  if (sys) settings.system_prompt = sys;
  const temp = flag("temperature");
  if (temp != null) settings.temperature = Number(temp);
  return settings;
}

const cmd = process.argv[2];

if (cmd === "ask") {
  const content = process.argv[3];
  if (!content || content.startsWith("--")) die('usage: alan.mjs ask "<prompt>" [--model <name>|--instant|--thinking|--gpt] [--system "<prompt>"] [--reasoning]');
  const res = await api("/chats/", { method: "POST", body: { content, settings: buildSettings(), api_only: true } });
  await streamChat(res);
} else if (cmd === "reply") {
  const chatId = process.argv[3], prevId = process.argv[4], content = process.argv[5];
  if (!chatId || !prevId || !content || content.startsWith("--"))
    die('usage: alan.mjs reply <chat_id> <prev_msg_id> "<prompt>" [flags]');
  const res = await api(`/chats/${chatId}/generate`, { method: "POST", body: { previous_message_id: prevId, content } });
  await streamChat(res);
} else if (cmd === "models") {
  const res = await api("/models/");
  if (!res.ok) die(`HTTP ${res.status}`);
  const data = await res.json();
  const models = (data.models || []).filter((m) => !/embedding/i.test(m.name));
  for (const m of models) {
    const tag = m.status === "available" ? "" : `  (${m.status})`;
    console.log(`${m.name}\t${m.title}${tag}`);
  }
} else {
  die('commands: ask "<prompt>" [flags]  |  reply <chat_id> <prev_msg_id> "<prompt>"  |  models');
}
