---
name: notify
description: Send the user a notification/message — or a file — on their phone via Telegram. Use when asked to "notify me", "send me a message/reminder", "ping me when…", "send me the file/document/image", or to deliver a result (text or a generated file) to the user (e.g. from a scheduled task). Goes ONLY to the user's own Telegram chat.
metadata:
  {
    "core":
      { "requires": { "bins": ["node"], "env": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] } }
  }
---

# Notify

Deliver to the user on Telegram — a short text message, or a file. It can only reach the
user (the configured chat) — never anyone else.

## Commands (run via bash)

**Text message:**

```bash
node /app/.pi/skills/notify/notify.mjs "your message here"
```

**A file** (document, image, generated report, etc. — optional caption):

```bash
node /app/.pi/skills/notify/send-file.mjs "/app/storage/artefacts/report.md" "your daily report"
```

Both print `{"sent":true,...}` on success. The file is sent as a Telegram document (max
50 MB), so it arrives downloadable and lossless regardless of type.

## Formatting (Telegram HTML)

The message renders in Telegram. Format it with ONLY these HTML tags: `<b>bold</b>`,
`<i>italic</i>`, `<u>`, `<s>`, `<code>inline</code>`, `<pre>block</pre>`,
`<a href="url">link</a>`. Do **not** use Markdown (no `**`, `#`, backticks). Escape literal
`<`, `>`, `&` as `&lt; &gt; &amp;`. No other tags. For lists, use lines starting with `•`.
Plain text with no tags is fine too.

## How to use it

1. Use it when the user asks to be notified/reminded, or to deliver the result of a task
   they won't be watching (e.g. a scheduled morning briefing). Keep messages concise.
   When the user wants an actual **file** (a generated doc, an image, an export), use
   `send-file.mjs` instead of pasting the contents into a message.
2. It's the delivery channel for proactive updates — pair it with other skills (e.g.
   run the morning-briefing, then `notify` the user with the summary; or generate a file
   and `send-file` it).
3. If it errors with "Telegram not configured", tell the user plainly — they need to set
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env` (see the README). Don't pretend
   a message was sent.
