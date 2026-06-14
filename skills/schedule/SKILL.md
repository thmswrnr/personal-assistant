---
name: schedule
description: Manage Core's scheduled/recurring tasks — list, add, or remove jobs that run automatically at set times. Use when the user says "every morning…", "remind me to…", "schedule…", "run X daily/hourly/weekdays at…", "what's scheduled", or "stop the … job". Each job runs a Core prompt on a cron schedule.
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["node"] } }
  }
---

# Schedule

Core runs scheduled jobs from `storage/schedule.json` (the scheduler is Core's own
process — no Telegram needed). Use this skill to manage them; changes apply live.

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
