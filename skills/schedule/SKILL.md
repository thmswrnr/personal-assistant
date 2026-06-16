---
name: schedule
description: Manage Core's scheduled/recurring JOBS — work Core itself runs automatically at set times (a daily briefing, an hourly check, a weekly report). Use when the user wants Core to DO something on a schedule — "every morning…", "run X daily/hourly/weekdays at…", "schedule a job to…", "what's scheduled", "stop the … job". NOT for the user's own reminders/to-dos — "remind me to <do a thing myself>" (even "in 1 hour") goes to the `todos` skill (Google Tasks). Each job runs a Core prompt on a cron schedule.
metadata:
  {
    "core":
      { "requires": { "bins": ["node"] } }
  }
---

# Schedule

Core runs scheduled jobs from `storage/schedule.json` (the scheduler is Core's own
process — no Telegram needed). Use this skill to manage them; changes apply live.

> **Schedule vs. todos — who does the work?** A scheduled job is *Core* doing something
> automatically at a time (fetch, summarize, notify, generate). A **reminder/to-do is the
> *user's* own action item** — that belongs in the `todos` skill (Google Tasks), which syncs
> to their phone, **even when it has a time** ("remind me to call the dentist in an hour" →
> add a Google Task, don't create a cron job). Only reach for `schedule` when the prompt is
> work Core itself should run on a recurring/timed basis.

## Commands (run via bash)

```bash
node /app/.pi/skills/schedule/schedule.mjs list

# cron = 5 fields: minute hour day-of-month month day-of-week (local time)
node /app/.pi/skills/schedule/schedule.mjs add \
  --label "Morning briefing" --cron "0 7 * * *" --prompt "/skill:morning-briefing"

node /app/.pi/skills/schedule/schedule.mjs remove --label "Morning briefing"
```

Common cron patterns: `0 7 * * *` = daily 07:00; `30 8 * * 1-5` = 08:30 on weekdays;
`0 * * * *` = top of every hour; `*/15 * * * *` = every 15 minutes.

## How to use it

1. Turn the user's request into a cron expression and a clear `prompt`. The prompt is
   what Core will run at that time — make it self-contained, and **include how to deliver
   the result** if they want one (e.g. "…and save it as an email draft", "…and notify me",
   "…and append it to my notes"). The scheduler itself just runs the prompt.
2. After `add`, confirm back in plain language ("Scheduled the morning briefing for 7am
   daily"). Use `list` to show what's set; `remove --label` to cancel one.
3. If the user's timing is ambiguous (which days? what time?), ask before adding.
