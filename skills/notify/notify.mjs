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

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: CHAT, text: text.slice(0, 4000) }),
});
if (!res.ok) die(`Telegram API ${res.status}: ${await res.text()}`);
const j = await res.json();
if (!j.ok) die(`Telegram error: ${JSON.stringify(j)}`);
console.log(JSON.stringify({ sent: true, chars: text.length }));
