---
name: morning-briefing
description: Give the user a short, friendly morning briefing. Use when the user asks for a "morning briefing", "good morning", "brief me", or similar. Currently a placeholder greeting until external data sources (email, calendar, todos) are connected.
---

# Morning Briefing

Greet the user warmly to start their day. This skill is an early placeholder — the real
data sources (email, calendar, to-do services) are **not connected yet**, so do not invent
any. Just deliver a nice, short briefing.

## Steps

1. Get today's date with `date "+%A, %B %d, %Y"` via bash.
2. Output a friendly **good morning** greeting that includes the day/date.
3. Tell one short, clean joke to start the day.
4. Add a one-line note that richer briefings (unread mail, calendar, open todos) will be
   available once those integrations are added.

Keep the whole thing brief and upbeat — a few lines, not a wall of text.

## Future (not yet implemented)

When external access exists, extend this to summarize: unread/important email, today's
calendar, and open items from `/app/storage/todos.md`.
