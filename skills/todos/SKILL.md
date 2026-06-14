---
name: todos
description: Manage the user's to-do checklist. Use when the user asks to add a todo/task/reminder ("remind me to…", "add a todo…"), see their todos, or mark something done. The list is a single markdown checklist file.
metadata:
  { "openclaw": { "requires": { "files": ["/app/storage/todos.md"] } } }
---

# Todos

The user's to-do list is the single file **`/app/storage/todos.md`**, a markdown
checklist. Always use this one file — never create separate files or notes for todos.

## Add a todo
Append a line to `/app/storage/todos.md`:
```
- [ ] <short, actionable task>
```
Use the `bash` append (`>>`) or `edit` so existing items are preserved (don't overwrite).
If the file doesn't exist yet, create it with a `# Todos` header first. Confirm what you added.

## List todos
Read `/app/storage/todos.md`. Show the open items (`- [ ]`); mention completed ones
(`- [x]`) only if asked.

## Complete a todo
Find the matching item and change its `- [ ]` to `- [x]` (use `edit`). Confirm.

## Rules
- **One file only** (`todos.md`). Do not scatter todos into `notes/` or new files.
- Keep each item short and actionable.
- Preserve existing items — append or edit in place, never overwrite the whole file.
