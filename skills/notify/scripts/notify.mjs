#!/usr/bin/env node
// Send the user a Telegram notification. Hard-limited to the user's own chat
// (TELEGRAM_CHAT_ID) — it cannot message anyone else. Uses the same bot token as the
// Telegram bridge. No third-party deps (Node built-in fetch).
//
// Usage:
//   node notify.mjs "your message text"
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;

function die(msg) {
  console.error(`notify: ${msg}`);
  process.exit(1);
}

const text = process.argv.slice(2).join(" ").trim();
if (!text) die('usage: notify.mjs "message"');
if (!TOKEN || !CHAT) die("Telegram not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.");

// Messages render in Telegram, which supports a small HTML subset — Core formats them as
// HTML (see SKILL.md). Send with parse_mode HTML; if Telegram rejects the markup (e.g. an
// unescaped < or &), retry once as plain text so the message still goes out.
async function post(parseMode) {
  const body = { chat_id: CHAT, text: text.slice(0, 4000) };
  if (parseMode) body.parse_mode = parseMode;
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return res.ok ? await res.json() : { ok: false, status: res.status, text: await res.text() };
}
let j = await post("HTML");
if (!j.ok) j = await post(null); // HTML rejected → fall back to plain
if (!j.ok) die(`Telegram error ${j.status}: ${j.text}`);
console.log(JSON.stringify({ sent: true, chars: text.length }));
