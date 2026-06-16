---
name: todos
description: Manage the user's main to-do list. Use when the user asks to add a todo/task/reminder ("remind me to…", "add a todo…"), see their todos, set a due date, or mark something done. Backed by Google Tasks, so it syncs with the user's phone (Google Tasks app) and the Gmail/Calendar side panel.
metadata:
  { "openclaw": { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } } }
---

# Todos

The user's **main** to-do list is **Google Tasks** — so anything here also shows up in the
Google Tasks app on their phone and the Gmail/Calendar side panel. Manage it with the CLI
(`node /app/.pi/skills/todos/todos.mjs`), which uses the shared Google OAuth token.

> **Project tasks go elsewhere.** This is the user's *general* list. Tasks that belong to a
> specific project live in that project's own `storage/projects/<slug>/todos.md` — see the
> `project-planning` skill. Don't mix project work into this list.

## Add a todo
```bash
node /app/.pi/skills/todos/todos.mjs add "Pick up parcel"
node /app/.pi/skills/todos/todos.mjs add "Call dentist" --due 2026-06-20
node /app/.pi/skills/todos/todos.mjs add "Email Sam the report" --notes "Q2 numbers"
```
`--due` is `YYYY-MM-DD` (Google Tasks tracks the date, not a time). Confirm what you added.

## List todos
```bash
node /app/.pi/skills/todos/todos.mjs list          # open tasks, each with a number (n)
node /app/.pi/skills/todos/todos.mjs list --all    # also show recently completed
```
Show the open items; the `n` is that task's number — use it for the commands below. Mention
completed tasks only if asked.

## Change a todo
```bash
node /app/.pi/skills/todos/todos.mjs done 2        # mark task #2 done
node /app/.pi/skills/todos/todos.mjs rm 2          # delete task #2
```
Always `list` first to get the right number, then act. Confirm the change.

## Multiple lists
The default Google Tasks list is used unless you pass `--list "<name>"` (matches a list by
title). `node …/todos.mjs lists` shows all the user's task lists. Most of the time, just use
the default.

## Rules
- Keep each item short and actionable.
- Main list only here. Project-specific tasks belong in `storage/projects/<slug>/todos.md`
  (see `project-planning`).
- If the CLI says credentials are missing, the user needs to run `scripts/google-oauth.mjs`
  (with the `tasks` scope) — don't invent tasks.
