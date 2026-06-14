---
name: process-inbox
description: Process local FILES/DOCUMENTS the user dropped into the storage inbox folder — summarize each into notes, capture action items into todos, then archive the original. Use for requests about local files/documents, e.g. "process my files", "go through the documents I dropped", "process the inbox folder". (Local files — NOT email; for email use the gmail skill.)
---

# Process Inbox

Turn raw files in the inbox into organized notes and actionable todos. Work through the
inbox one file at a time and leave a clean audit trail.

## Paths

- Inbox:     `/app/storage/inbox/`
- Notes:     `/app/storage/notes/`      (the "second brain")
- Todos:     `/app/storage/todos.md`
- Processed: `/app/storage/processed/`   (archive of handled originals)

## Steps

1. **List the inbox.** First ensure the folders exist:
   `mkdir -p /app/storage/inbox /app/storage/notes /app/storage/processed`. Then
   `ls /app/storage/inbox/`. If it's empty, tell the user there's nothing to process and stop.
2. **For each file, complete ALL FOUR sub-steps before moving to the next file.** A file is
   only finished once it has been archived (step d). Do not stop after writing the note.
   a. **Read** it. Plain text / markdown / code: read directly. For other types, do your
      best with the tools available and note any file you could not read (e.g. images —
      OCR/vision is not set up yet) instead of guessing at contents.
   b. **Summarize** it into a new note at `/app/storage/notes/<short-slug>.md` with a
      title, a 2–4 sentence summary, the original filename, and today's date (get it with
      `date +%Y-%m-%d` via bash). Keep one note per inbox item.
   c. **Extract action items.** If the file implies anything to do, append a line to
      `/app/storage/todos.md` using the bash `>>` append (do NOT overwrite the file):
      `- [ ] <action> (from <filename>)`. If there are genuinely no actions, skip this.
   d. **Archive** the original with bash: `mv /app/storage/inbox/<file> /app/storage/processed/`.
3. **Verify before finishing.** Run `ls /app/storage/inbox/` again — it must be empty (every
   file moved to `processed/`). If anything remains, you are not done: go back and finish it.
4. **Report** a concise summary to the user: how many items processed, the notes created,
   and any new todos. Mention anything you skipped or couldn't read.

You are NOT done until every inbox file has a note AND has been moved to `processed/`.

## Rules

- Never delete inbox files — always *move* them to `processed/`.
- Don't invent content for files you couldn't read; flag them instead.
- Keep notes short and scannable; the goal is a useful second brain, not a transcript.
