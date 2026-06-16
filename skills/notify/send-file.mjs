#!/usr/bin/env node
// Send the user a file (document/image/etc.) on Telegram. Hard-limited to the user's own
// chat (TELEGRAM_CHAT_ID) — same bot token as notify.mjs / the Telegram bridge. It cannot
// send to anyone else. No third-party deps (Node built-in fetch/FormData/Blob).
//
// Usage:
//   node send-file.mjs "/path/to/file" "optional caption"
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;

function die(msg) {
  console.error(`send-file: ${msg}`);
  process.exit(1);
}

const filePath = process.argv[2];
const caption = process.argv[3] || "";
if (!filePath) die('usage: send-file.mjs "/path/to/file" "optional caption"');
if (!existsSync(filePath)) die(`file not found: ${filePath}`);
if (!TOKEN || !CHAT) die("Telegram not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.");

const buf = await readFile(filePath);
// Telegram bot API caps sendDocument uploads at 50 MB.
if (buf.length > 50 * 1024 * 1024) {
  die(`file too large (${(buf.length / 1048576).toFixed(1)} MB); Telegram's limit is 50 MB.`);
}

const form = new FormData();
form.append("chat_id", CHAT);
if (caption) form.append("caption", caption.slice(0, 1024)); // Telegram caption limit
form.append("document", new Blob([buf]), basename(filePath));

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, { method: "POST", body: form });
if (!res.ok) die(`Telegram API ${res.status}: ${await res.text()}`);
const j = await res.json();
if (!j.ok) die(`Telegram error: ${JSON.stringify(j)}`);
console.log(JSON.stringify({ sent: true, file: basename(filePath), bytes: buf.length }));
