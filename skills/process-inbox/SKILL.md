---
name: process-inbox
description: Process local FILES/DOCUMENTS/IMAGES the user dropped into the storage inbox folder — read each (including photos, screenshots, receipts, scans), summarize into notes, capture action items into todos, then archive the original. Use for requests about local files, e.g. "process my files", "go through the documents I dropped", "process the inbox folder". (Local files — NOT email; for email use the gmail skill.)
---

# Process Inbox

Turn raw files in the inbox into organized notes and actionable todos. Work through the
inbox one file at a time and leave a clean audit trail.

## Paths

- Inbox:     `/app/storage/inbox/`
- Notes:     `/app/storage/notes/`      (the "second brain")
- Todos:     the user's Google Tasks list — add via the `todos` skill (not a local file)
- Archive:   `/app/storage/archived/`    (archive of handled originals)

## Steps

1. **List the inbox.** First ensure the folders exist:
   `mkdir -p /app/storage/inbox /app/storage/notes /app/storage/archived`. Then
   `ls /app/storage/inbox/`. Delete any Windows download-marker files first — names ending
   in `Zone.Identifier` are not content (`rm /app/storage/inbox/*Zone.Identifier* 2>/dev/null`).
   If the inbox is then empty, tell the user there's nothing to process and stop.
2. **For each file, complete ALL FOUR sub-steps before moving to the next file.** A file is
   only finished once it has been archived (step d). Do not stop after writing the note.
   a. **Read** it. Plain text / markdown / code: read directly. **Images** (photos,
      screenshots, receipts, scans): read them too — the model can see images — and pull
      out the useful content (e.g. a receipt → vendor, total, date; a screenshot → the
      text/info shown). For any other binary type you genuinely cannot read, note that
      instead of guessing — but still archive it in step d.
   b. **Summarize** it into a new note at `/app/storage/notes/<short-slug>.md` with a
      title, a 2–4 sentence summary, the original filename, and today's date (get it with
      `date +%Y-%m-%d` via bash). Keep one note per inbox item. **Exception:** if it's a
      receipt/invoice for purchases (see c2), it's logged as an expense instead — skip the
      note for it.
   c. **Extract action items.** If the file implies anything to do, add it to the user's
      to-do list with the `todos` skill (e.g. `node /app/.pi/skills/todos/todos.mjs add
      "<action> (from <filename>)"`). If there are genuinely no actions, skip this.
   c2. **Is it a shopping receipt or an invoice for purchases?** (Kassenbon, Rechnung with
      line items.) Then it's an **expense** — hand it to the `haushaltsbuch` skill to log it
      (classify items → sum per category → append to Variable Ausgaben). The haushaltsbuch
      row is the record — **don't also write a note** (skip step b for it). Archive as usual.
      Confirm the breakdown with the user before writing to the sheet.
   d. **Archive** the original with bash: `mv /app/storage/inbox/<file> /app/storage/archived/`.
3. **Verify before finishing.** Run `ls /app/storage/inbox/` again — it must be empty (every
   file moved to `archived/`). If anything remains, you are not done: go back and finish it.
4. **Report** a concise summary to the user: how many items processed, the notes created,
   and any new todos. Mention anything you skipped or couldn't read.

You are NOT done until every inbox file has been handled (a note, or logged as an expense)
AND has been moved to `archived/`.

## Rules

- Never delete inbox files — always *move* them to `archived/`.
- Don't invent content for files you couldn't read; flag them instead.
- Keep notes short and scannable; the goal is a useful second brain, not a transcript.
