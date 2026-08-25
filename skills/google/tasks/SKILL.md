---
name: tasks
description: Manage the user's task lists in Google Tasks — a multi-list task manager, not one flat to-do list. Use when the user wants to add/see/complete/delete a task or reminder ("remind me to…", "add a todo…", incl. timed ones like "…in an hour"), put something on a specific list (e.g. a shopping list — "we need milk", "auf die Einkaufsliste"), create a new list, or import a list of items. The user's own lists and where things go are personal conventions — check long-term memory for them. For work CORE itself runs on a timer (briefings, recurring checks), use `schedule` instead.
metadata:
  { "core": { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } } }
---

# Tasks (multi-list task manager)

The user's tasks live in **Google Tasks** (synced to their phone + the Gmail/Calendar side
panel). It's a **multi-list** manager: there's a default list plus any others the user keeps.
This skill is generic — it doesn't assume any particular list names. Manage everything with the
CLI (`node /app/.pi/skills/google/tasks/scripts/tasks.mjs`), which uses the shared Google OAuth
token.

## Which list does an item go on?

- **The user's own lists are a personal convention, not part of this skill.** If they keep
  dedicated lists (e.g. a shopping list, an automated-capture/triage list), that lives in
  **long-term memory** — read the relevant memory fact (look for one about their task lists)
  and route accordingly. If memory says nothing, fall back to the rules below.
- **Default:** a reminder or to-do the user states for themselves → the **default list** (no
  `--list` needed).
- **Named list:** when the user points at a specific list ("on my shopping list", "to the work
  list") → `--list "<name>"` (substring match, case-insensitive). Run `lists` first if unsure
  what exists.
- **Don't add to a list on the user's behalf unless they asked.** Unattended/automated capture
  (e.g. `process-inbox`) should target a dedicated capture list per the user's convention, never
  their main list.

> **Reminders go here, not on the cron.** "Remind me to <do something myself>" is a to-do for
> the user → a task, *even if it names a time* ("…in an hour", "…tomorrow"). Google Tasks tracks
> a `--due` **date** (not a clock time). Only use the `schedule` skill when the user wants
> **Core** to run work at a time.
>
> **Project tasks go elsewhere.** Tasks tied to a specific project live in that project's own
> `storage/projects/<slug>/todos.md` (see `project-planning`) — not in Google Tasks.

## See what lists exist
```bash
node /app/.pi/skills/google/tasks/scripts/tasks.mjs lists        # all task lists (titles + ids)
```

## Add a task (default list unless --list is given)
```bash
node /app/.pi/skills/google/tasks/scripts/tasks.mjs add "Pick up parcel"                  # → default list
node /app/.pi/skills/google/tasks/scripts/tasks.mjs add "Call dentist" --due 2026-06-20    # with a due date
node /app/.pi/skills/google/tasks/scripts/tasks.mjs add "Milch" --list "Einkauf"           # onto a named list (substring)
```
`--due` is `YYYY-MM-DD`. Confirm what you added **and to which list**.

### Bulk import (several items at once)
Pass multiple titles in one call — they keep their given order. Ideal for turning a checklist
(e.g. a packing list) into tasks without one call per item:
```bash
node /app/.pi/skills/google/tasks/scripts/tasks.mjs add "Reisepass" "VPN" "Powerbank" "Adapter" --list "China"
```

## Create a new list
```bash
node /app/.pi/skills/google/tasks/scripts/tasks.mjs new-list "China Packliste"
```
Common flow — "make a list out of this": `new-list "<title>"`, then a single bulk `add … --list
"<title>"` with all the items.

## List / change tasks
```bash
node /app/.pi/skills/google/tasks/scripts/tasks.mjs list                       # open tasks on the default list
node /app/.pi/skills/google/tasks/scripts/tasks.mjs list --list "Einkauf"       # open tasks on a named list
node /app/.pi/skills/google/tasks/scripts/tasks.mjs list --all                 # also show recently completed
node /app/.pi/skills/google/tasks/scripts/tasks.mjs done 2 [--list "<name>"]   # complete task #2 on that list
node /app/.pi/skills/google/tasks/scripts/tasks.mjs rm   2 [--list "<name>"]   # delete task #2 on that list
```
`--list` matches a list by title (substring, case-insensitive). The `n` in `done`/`rm` comes
from a `list` of **that same list** — always `list` first, then act, then confirm.

To **move an item between lists**: `list --list "<from>"` to find it, `add` it to the target,
then `rm <n> --list "<from>"`.

## Notes
- Keep each item short and actionable.
- If the CLI says credentials are missing, the user needs to run `scripts/google-oauth.mjs`
  (with the `tasks` scope) — don't invent tasks.
