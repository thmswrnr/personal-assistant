---
name: morning-briefing
description: Give the user a short morning briefing — a dated greeting, a summary of recent unread email, today's calendar, the weather, and a joke. Use when the user asks for a "morning briefing", "good morning", "brief me", or similar.
---

# Morning Briefing

A short, friendly start to the day. Orchestrates other capabilities — keep the whole
thing brief and scannable, not a wall of text.

## Steps

1. **Greeting.** Get the date with `date "+%A, %B %d, %Y"` and open with a warm
   good-morning that includes the day/date.

2. **Unread email (today only).** Use the **gmail** skill to fetch unread email from the last day.
   - Lead with the count: e.g. "~23 unread in the last day".
   - Then summarize only the **notable few** as **sender — subject**: surface anything
     personal or time-sensitive first, and group/condense bulk newsletters into one line
     (e.g. "+ several newsletters"). Do not list everything even if there are many.
   - If there are none, say so. If it's unavailable (e.g. credentials not set up),
     mention it in one line and continue — do **not** invent emails.

3. **Today's calendar.** Use the **calendar** skill to get what's on today.
   - List what's left of today as **time — title** (e.g. "10:00 Standup, 14:00 Dentist"),
     noting all-day events separately. If nothing's left today, say the day looks clear.
   - If it's unavailable (e.g. credentials not set up), mention it in one line and
     continue — do **not** invent events.

4. **Weather.** Use the **weather** skill to get today's forecast for the user's home city.
   - Give a one-liner: current temp + conditions and today's high/low, and call out rain
     if the chance is notable (e.g. "pack an umbrella").
   - If you don't know the user's city, ask once and save it with `/skill:memory` (so future
     briefings have it); skip this step gracefully if it's still unknown or it's unavailable.

5. **Joke.** Tell one short, clean joke.

## Rules

- Read-only: only summarize, never imply you sent or changed anything (the per-step "don't
  invent" caveats still apply — report only what each CLI returned).
