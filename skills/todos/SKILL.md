---
name: todos
description: Manage the user's main to-do list. Use when the user asks to add a todo/task/reminder ("remind me to…", "add a todo…"), see their todos, set a priority or due date, or mark something done. Backed by the standard todo.txt format via the `todo.sh` CLI.
metadata:
  { "openclaw": { "requires": { "bins": ["todo.sh"] } } }
---

# Todos

The user's **main** to-do list lives at `/app/storage/todo.txt` in the standard
[todo.txt](https://github.com/todotxt/todo.txt) format. Manage it with the official **`todo.sh`**
CLI — never hand-edit the file, so the format (priorities, dates, archiving) stays correct.

`todo.sh` is pre-configured (global config at `/etc/todo/config`): `TODO_DIR=/app/storage`,
creation dates auto-stamped on add, completed items auto-archived to `done.txt`. Just run it.

> **Project tasks go elsewhere.** This is the user's *general* list. Tasks that belong to a
> specific project live in that project's own `todo.txt` under `storage/projects/<slug>/` — see
> the `project-planning` skill. Don't mix project work into the main list.

## Add a todo
```bash
todo.sh add "Pick up parcel"                       # plain task (creation date auto-added)
todo.sh add "(A) Call dentist due:2026-06-20"      # with priority A and a due date
todo.sh add "Email Sam @work +taxes"               # @context and +project tags are optional
```
todo.txt syntax: `(A)`–`(Z)` priority at the start, `@context`, `+project`, and `key:value`
(e.g. `due:2026-06-20`). Confirm what you added.

## List todos
```bash
todo.sh ls               # all open tasks, sorted by priority (each line is numbered)
todo.sh ls +taxes        # filter: only tasks matching "+taxes" (or any term/@context)
todo.sh lsp              # only prioritized tasks
```
Show the open items; the leading number is that task's id (use it for the commands below).
Mention completed tasks only if asked — they're archived to `done.txt` (`todo.sh listall` to see).

## Change a todo
```bash
todo.sh do 3             # mark task 3 done (stamps completion date, archives it)
todo.sh pri 3 A          # set/raise priority of task 3 to A
todo.sh depri 3          # remove its priority
todo.sh append 3 "due:2026-07-01"   # add text/metadata to task 3
todo.sh rm 3             # delete task 3
```
Always `ls` first to find the right number, then act. Confirm the change.

## Rules
- **Use `todo.sh`, never edit `todo.txt` by hand** — the CLI keeps dates, priorities and
  archiving consistent.
- Main list only here. Project-specific tasks belong in `storage/projects/<slug>/` (see
  `project-planning`).
- Keep each item short and actionable.
