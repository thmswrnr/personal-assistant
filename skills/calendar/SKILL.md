---
name: calendar
description: Read the user's Google Calendar — list calendars and show upcoming events, today's agenda, or search events. Use for "what's on my calendar", "what do I have today/this week", "am I free…", "when is my next meeting", "any events about …". Read-only.
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } }
  }
---

# Google Calendar

Access the user's Google Calendar via a small CLI that calls the official Calendar
API. It is **read-only** — it never creates, edits, or deletes events.

## Commands (run via bash)

```bash
# The user's calendars (find ids; "primary" is the default for the others)
node /app/.pi/skills/calendar/calendar.mjs list

# Upcoming events for the next N days (default 7)
node /app/.pi/skills/calendar/calendar.mjs agenda 7

# Just what's left of today
node /app/.pi/skills/calendar/calendar.mjs today

# Search events by text within the next N days (default 30)
node /app/.pi/skills/calendar/calendar.mjs search "dentist" 30

# Any command can target a specific calendar:
node /app/.pi/skills/calendar/calendar.mjs agenda 3 --calendar <calendarId>
```

Each command prints JSON. Event commands return
`{window, events: [{summary, start, end, allDay, location, link}]}` where `start`/`end`
are ISO strings (all-day events use a date only and `allDay: true`).

## How to use it

1. Pick the narrowest command: **today** for "today", **agenda N** for "this week"/
   "next few days", **search** when the user names a topic.
2. Summarize concisely — lead with times and titles (e.g. "10:00 Standup, 14:00 Dentist").
   Note all-day events separately. Convert ISO times to a friendly format for the user.
3. For "am I free at <time>?" use `today`/`agenda` and reason over the returned events —
   don't claim availability the data doesn't support.
4. **Never invent events.** If a command errors (e.g. missing credentials, or the
   Calendar API not enabled), report that plainly instead of guessing.

## Setup (one time)

Requires `data/secrets/google_oauth.json` with the `calendar.readonly` scope. If it's
missing or lacks the scope, the user runs `node scripts/google-oauth.mjs` on the host
once (with the Calendar API enabled in their Google Cloud project).
