---
name: morning-briefing
description: Give the user a short morning briefing — a dated greeting, a summary of recent unread email, and a joke. Use when the user asks for a "morning briefing", "good morning", "brief me", or similar.
---

# Morning Briefing

A short, friendly start to the day. Orchestrates other capabilities — keep the whole
thing brief and scannable, not a wall of text.

## Steps

1. **Greeting.** Get the date with `date "+%A, %B %d, %Y"` and open with a warm
   good-morning that includes the day/date.

2. **Unread email (today only).** Run the read-only Gmail CLI:
   ```bash
   node /app/.pi/skills/gmail/gmail.mjs search "is:unread newer_than:1d" 10
   ```
   - Lead with the count: use `estimatedTotal` to say e.g. "~23 unread in the last day".
   - Then summarize only the **notable few** as **sender — subject**: surface anything
     personal or time-sensitive first, and group/condense bulk newsletters into one line
     (e.g. "+ several newsletters"). Do not list everything even if there are many.
   - If there are none, say so. If the command errors (e.g. credentials not set up),
     mention it in one line and continue — do **not** invent emails.

3. **Joke.** Tell one short, clean joke.

4. **Note.** One line that calendar and to-do summaries will be added here once those
   integrations exist.

## Rules

- Read-only: only summarize, never imply you sent or changed anything.
- Don't fabricate email content — only report what the CLI returned.
