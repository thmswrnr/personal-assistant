---
name: calendar
description: Read AND manage the user's Google Calendar — list calendars, show upcoming events / today's agenda / search, and create, edit, or delete events. Use for "what's on my calendar", "what do I have today/this week", "am I free…", "when is my next meeting", and "add/schedule/move/cancel …".
metadata:
  {
    "core":
      { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } }
  }
---

# Google Calendar

Access and manage the user's Google Calendar via a small CLI that calls the official Calendar
API. Reading is free to do; **writes (add/edit/rm) change the user's real calendar — confirm
with the user before making one.**

## Read

```bash
node /app/.pi/skills/calendar/scripts/calendar.mjs list            # the user's calendars (find ids)
node /app/.pi/skills/calendar/scripts/calendar.mjs agenda 7        # upcoming events, next N days (default 7)
node /app/.pi/skills/calendar/scripts/calendar.mjs today           # just what's left of today
node /app/.pi/skills/calendar/scripts/calendar.mjs search "dentist" 30   # by text, next N days
# any command: add `--calendar <id>` to target a non-primary calendar
```

Event commands print `{window, events: [{id, summary, start, end, allDay, location, link}]}` —
`start`/`end` are ISO strings (all-day events use a date and `allDay: true`). The **`id`** is
what you pass to `edit`/`rm`.

## Write (confirm with the user first)

```bash
# Create — timed (default duration 1h if --end omitted; default tz Europe/Berlin)
node /app/.pi/skills/calendar/scripts/calendar.mjs add "Dentist" --start 2026-06-20T15:00 --end 2026-06-20T16:00 --location "Bonn"
# Create — all-day (date only; spans one day unless --end given)
node /app/.pi/skills/calendar/scripts/calendar.mjs add "Holiday" --start 2026-07-01

# Edit (only the fields you pass change). Get <eventId> from a read command first.
node /app/.pi/skills/calendar/scripts/calendar.mjs edit <eventId> --start 2026-06-20T16:00 --end 2026-06-20T17:00
node /app/.pi/skills/calendar/scripts/calendar.mjs edit <eventId> --title "New title" --location "Office"

# Delete
node /app/.pi/skills/calendar/scripts/calendar.mjs rm <eventId>
```

`<when>` is `YYYY-MM-DD` (all-day) or `YYYY-MM-DDTHH:MM` (timed). To **reschedule a timed
event**, pass both `--start` and `--end`. Optional `--desc "…"` adds a description.

## How to use it

1. Pick the narrowest read command: **today**, **agenda N**, or **search** by topic.
2. Summarize concisely — lead with times and titles; note all-day events separately. Convert
   ISO times to a friendly format.
3. For "am I free at <time>?" reason over the returned events — don't claim availability the
   data doesn't support.
4. **Before any write**, confirm the specifics with the user (title, date/time, which event for
   edit/rm) — then run the command and report what changed.
5. **Never invent events.** If a command errors (missing credentials / API not enabled), report
   it plainly.

## Setup (one time)

Requires `data/secrets/google_oauth.json` with the `calendar.events` scope. If it's missing or
lacks the scope, run `node scripts/google-oauth.mjs` on the host once (Calendar API enabled in
the Google Cloud project).
