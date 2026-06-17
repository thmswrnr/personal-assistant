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
//   node alan.mjs ask "<prompt>" [--model <name>] [--reasoning]
//   node alan.mjs reply <chat_id> "<prompt>" [--reasoning]
//   node alan.mjs chats [--limit N | --all]        # list chats, newest first
//   node alan.mjs search "<query>" [--bookmarked]   # find chats by title/message content
//   node alan.mjs models [--available]             # list models (extended info)
//
// `ask` answers in a fresh, UI-hidden chat and prints "— chat <chat_id>" to stderr.
// `reply` continues a chat from its latest message (resolved here); the chat_id comes
//   from that footer, from `chats`, or from `search`.

import { readFileSync } from "node:fs";


const BASE = (process.env.ALAN_API_BASE || "https://dev.alan.de/api/v1").replace(/\/$/, "");

// Default model when `ask` is called without --model: a fast, available chat model
// (see `models --available`). Override per call with --model <name>.
const DEFAULT_MODEL = "comma-soft/gemma4-31b-instant";


function die(message) {
  console.error(`alan: ${message}`);
  process.exit(1);
}


function apiKey() {
  if (process.env.ALAN_API_KEY) {
    return process.env.ALAN_API_KEY.trim();
  }

  try {
    return readFileSync("/app/secrets/alan_api_key", "utf8").trim() || null;
  }
  catch {
    return null;
  }
}


// --- tiny arg helpers --------------------------------------------------------

function flag(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function has(name) {
  return process.argv.includes(`--${name}`);
}


// --- HTTP --------------------------------------------------------------------

async function api(path, { method = "GET", body } = {}) {
  const key = apiKey();
  if (!key) {
    die("no API key — set $ALAN_API_KEY or put it in /app/secrets/alan_api_key");
  }

  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}


// The newest message in a chat = the one no other message lists as its previous
// (the tail of the previous_message_id chain). That's what `generate` follows.
async function latestMessageId(chatId) {
  const res = await api(`/chats/${chatId}/messages/`);
  if (!res.ok) {
    die(`HTTP ${res.status} fetching messages for chat ${chatId}`);
  }

  const data = await res.json();
  const msgs = Array.isArray(data) ? data : (data.messages || []);
  if (!msgs.length) {
    die(`chat ${chatId} has no messages — can't continue it`);
  }

  const referenced = new Set(msgs.map((m) => m.previous_message_id).filter(Boolean));
  const tail = msgs.find((m) => !referenced.has(m.resource_id));

  return (tail || msgs[0]).resource_id;
}


// Drive a chat SSE stream to completion, printing assistant tokens as they arrive.
// Prints the answer to stdout and the chat id to stderr (for `reply`).
async function streamChat(res) {
  if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    }
    catch {
      // non-JSON error body — fall through with what we have
    }
    die(`HTTP ${res.status} ${detail}`);
  }

  if (!res.body) {
    die(`HTTP ${res.status} — empty response`);
  }

  const showReasoning = has("reasoning");

  let answer = "";
  let chatId = null;
  let printedAny = false;
  let inReasoning = false;

  const decoder = new TextDecoder();
  let buf = "";

  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });

    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trimEnd();
      buf = buf.slice(nl + 1);

      if (!line.startsWith("data:")) {
        continue;
      }

      let ev;
      try {
        ev = JSON.parse(line.slice(5).trim());
      }
      catch {
        continue;
      }

      switch (ev.kind) {

        case "chat":
          chatId = ev.chat?.resource_id || chatId;
          break;

        case "tokens":
          if (showReasoning && ev.reasoning_tokens) {
            if (!inReasoning) {
              process.stdout.write("\x1b[2m"); // dim
              inReasoning = true;
            }
            process.stdout.write(ev.reasoning_tokens);
          }

          if (ev.tokens) {
            if (inReasoning) {
              process.stdout.write("\x1b[0m\n");
              inReasoning = false;
            }
            process.stdout.write(ev.tokens);
            answer += ev.tokens;
            printedAny = true;
          }
          break;

        case "message":
          // Final, authoritative copy of the assistant turn.
          if (ev.message?.role === "assistant" && ev.message?.state === "Done") {
            if (ev.message.content) {
              answer = ev.message.content; // trust final content
            }
          }
          break;

        case "error":
          if (inReasoning) {
            process.stdout.write("\x1b[0m");
          }
          die(ev.message || ev.detail || "stream error");
      }
    }
  }

  if (inReasoning) {
    process.stdout.write("\x1b[0m");
  }

  if (printedAny) {
    process.stdout.write("\n");
  }
  else if (answer) {
    console.log(answer);
  }
  else {
    die("no answer returned");
  }

  if (chatId) {
    console.error(`\n— chat ${chatId}`);
  }
}


// --- commands ----------------------------------------------------------------

const cmd = process.argv[2];


if (cmd === "ask") {
  const content = process.argv[3];
  if (!content || content.startsWith("--")) {
    die('usage: alan.mjs ask "<prompt>" [--model <name>] [--reasoning]');
  }

  const settings = { model: flag("model", DEFAULT_MODEL) };

  const res = await api("/chats/", {
    method: "POST",
    body: { content, settings, api_only: true },
  });
  await streamChat(res);
}

else if (cmd === "reply") {
  // Continue a chat from its latest message. chat_id comes from ask's footer,
  // `chats`, or `search`; the tip is resolved here, so only the chat id is needed.
  const chatId = process.argv[3];
  const content = process.argv[4];
  if (!chatId || !content || content.startsWith("--")) {
    die('usage: alan.mjs reply <chat_id> "<prompt>"');
  }

  const previous_message_id = await latestMessageId(chatId);

  const res = await api(`/chats/${chatId}/generate`, {
    method: "POST",
    body: { previous_message_id, content },
  });
  await streamChat(res);
}

else if (cmd === "chats") {
  const res = await api("/chats/");
  if (!res.ok) {
    die(`HTTP ${res.status}`);
  }

  const all = (await res.json()).chats || [];
  all.sort((a, b) => (b.updated || "").localeCompare(a.updated || "")); // newest first

  const limit = has("all") ? all.length : Number(flag("limit", 15));

  const out = all.slice(0, limit).map((c) => ({
    id: c.resource_id,
    title: c.title || null, // chats started via this skill (api_only) have no title
    updated: c.updated,
    model: c.settings?.model,
    apiOnly: c.api_only || false,
  }));

  console.log(JSON.stringify(out, null, 2));
}

else if (cmd === "search") {
  // Find chats by content: POST /search/ matches chat titles AND message text,
  // returning { results: [{ chat_id, excerpt }] } — enough to pick a chat_id for
  // `reply` (api_only chats have no title, so this is how to find them by topic).
  const query = process.argv[3];
  if (!query || query.startsWith("--")) {
    die('usage: alan.mjs search "<query>" [--bookmarked]');
  }

  const body = { query };
  if (has("bookmarked")) {
    body.bookmarked = true;
  }

  const res = await api("/search/", { method: "POST", body });
  if (!res.ok) {
    die(`HTTP ${res.status}`);
  }

  console.log(JSON.stringify(await res.json(), null, 2));
}

else if (cmd === "models") {
  // Passthrough of GET /models/extended/ — richer than /models/: model_type,
  // capabilities (e.g. "vision"), reasoning_levels, primary_name (+ valid_names
  // aliases). Small payload, Core jq's it. --available trims to chat-usable models.
  const res = await api("/models/extended/");
  if (!res.ok) {
    die(`HTTP ${res.status}`);
  }

  let models = (await res.json()).models || [];
  if (has("available")) {
    models = models.filter((m) => m.status === "available" && m.model_type === "chatllm");
  }

  console.log(JSON.stringify({ models }, null, 2));
}

else {
  die('commands: ask "<prompt>" [--model M] [--reasoning]  |  reply <chat_id> "<prompt>"  |  chats [--limit N|--all]  |  search "<query>" [--bookmarked]  |  models [--available]');
}
