---
name: tasks
description: Manage the user's task lists (Google Tasks) — a multi-list task manager, not one flat to-do list. The user has THREE lists, each with a role - Todo (their main personal list), Einkaufsliste (shopping), Inbox (capture/triage). Use when the user wants to add/see/complete a task or reminder ("remind me to…", "add a todo…", incl. timed ones like "…in an hour"), add something to the shopping list ("auf die Einkaufsliste", "add to my shopping list", "we need milk"), or review/clear the Inbox list. Routes to the right list by intent (see the skill). For work CORE itself runs on a timer (briefings, recurring checks), use `schedule` instead.
metadata:
  { "core": { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } } }
---

# Tasks (multi-list task manager)

The user's tasks live in **Google Tasks** (synced to their phone + the Gmail/Calendar side
panel). It's not one list — there are **three lists, each with a distinct role**. Your job is
to put each item on the **right** list. Manage them with the CLI
(`node /app/.pi/skills/tasks/scripts/tasks.mjs`), which uses the shared Google OAuth token.

## The lists and where things go

| List | Role | Who writes to it |
|------|------|------------------|
| **Todo** | The user's main personal to-do list (this is the default list). | **Only when the user explicitly asks** — "add a todo", "remind me to…". |
| **Einkaufsliste** | Shopping list (groceries/things to buy). | When the user says to add to the shopping list — "auf die Einkaufsliste", "add to shopping list", "we're out of X", "we need Y". |
| **Inbox** | Capture / triage — lower-confidence items pulled out automatically (e.g. by `process-inbox`). The user reviews these and promotes the real ones to **Todo**. | Automated/unattended capture. **Never** dump these into Todo. |

**Routing rules:**
- A reminder or to-do the user states for themselves → **Todo** (default list; no `--list` needed).
- Anything shopping-related → **`--list "Einkaufsliste"`**.
- Actions extracted by automation (not the user directly asking) → **`--list "Inbox"`**.
- **Don't write to Todo on the user's behalf unless they asked.** Automated flows use Inbox.

> **Reminders go here, not on the cron.** "Remind me to <do something myself>" is a to-do for
> the user → **Todo**, *even if it names a time* ("…in an hour", "…tomorrow"). Google Tasks
> tracks a `--due` **date** (not a clock time). Only use the `schedule` skill when the user
> wants **Core** to run work at a time.
>
> **Project tasks go elsewhere.** Tasks tied to a specific project live in that project's own
> `storage/projects/<slug>/todos.md` (see `project-planning`) — not in any of these lists.

## Add a task (pick the list per the rules above)
```bash
node /app/.pi/skills/tasks/scripts/tasks.mjs add "Pick up parcel"                       # → Todo (default)
node /app/.pi/skills/tasks/scripts/tasks.mjs add "Call dentist" --due 2026-06-20         # → Todo, with a due date
node /app/.pi/skills/tasks/scripts/tasks.mjs add "Milch" --list "Einkaufsliste"          # → shopping list
node /app/.pi/skills/tasks/scripts/tasks.mjs add "Renew passport (from scan.pdf)" --list "Inbox"  # → capture
```
`--due` is `YYYY-MM-DD`. Confirm what you added **and to which list**.

## List / change tasks
```bash
node /app/.pi/skills/tasks/scripts/tasks.mjs list                       # open tasks on Todo (default)
node /app/.pi/skills/tasks/scripts/tasks.mjs list --list "Einkaufsliste" # open tasks on another list
node /app/.pi/skills/tasks/scripts/tasks.mjs list --all                 # also show recently completed
node /app/.pi/skills/tasks/scripts/tasks.mjs done 2 [--list "<name>"]   # complete task #2 on that list
node /app/.pi/skills/tasks/scripts/tasks.mjs rm   2 [--list "<name>"]   # delete task #2 on that list
node /app/.pi/skills/tasks/scripts/tasks.mjs lists                      # show all task lists
```
`--list` matches a list by title (substring, case-insensitive). The `n` in `done`/`rm` comes
from a `list` of **that same list** — always `list` first, then act, then confirm.

"Promote from Inbox to Todo" = `list --list "Inbox"` to find it, `add` it to Todo, then
`rm <n> --list "Inbox"`.

## Notes
- Keep each item short and actionable.
- If the CLI says credentials are missing, the user needs to run `scripts/google-oauth.mjs`
  (with the `tasks` scope) — don't invent tasks.
