---
name: notify
description: Send the user a notification/message on their phone via Telegram. Use when asked to "notify me", "send me a message/reminder", "ping me when…", or to deliver a result to the user (e.g. from a scheduled task). Goes ONLY to the user's own Telegram chat.
metadata:
  {
    "core":
      { "requires": { "bins": ["node"], "env": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] } }
  }
---

# Notify

Send the user a short message on Telegram. It can only message the user (the configured
chat) — never anyone else.

## Command (run via bash)

```bash
node /app/.pi/skills/notify/notify.mjs "your message here"
```

Prints `{"sent":true,...}` on success.

## How to use it

1. Use it when the user asks to be notified/reminded, or to deliver the result of a task
   they won't be watching (e.g. a scheduled morning briefing). Keep messages concise.
2. It's the delivery channel for proactive updates — pair it with other skills (e.g.
   run the morning-briefing, then `notify` the user with the summary).
3. If it errors with "Telegram not configured", tell the user plainly — they need to set
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env` (see the README). Don't pretend
   a message was sent.
