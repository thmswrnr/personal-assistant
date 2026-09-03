---
name: process-inbox
description: Process the FILES/DOCUMENTS/IMAGES the user dropped for Core — in their Google Drive `__inbox__` folder or in the local storage inbox. ALWAYS pulls the Drive inbox in first, then reads each file (photos, screenshots, receipts, scans, PDFs, Office documents), summarizes into artefacts, captures action items into todos, and archives the original. Use for "process my inbox", "check my inbox", "process my files", "go through the documents I dropped". (Files — NOT email; for email use the gmail skill.)
---

# Process Inbox

Turn raw files into organized artefacts and actionable todos. Files arrive in two places and this
skill always covers both: the **Drive inbox** is pulled into the **local inbox** first, then the
local inbox is worked through one file at a time, leaving a clean audit trail.

## Paths

- Drive source: the `__inbox__` folder in Google Drive (pulled in at step 1)
- Inbox:     `/app/storage/inbox/`
- Artefacts: `/app/storage/artefacts/`   (the "second brain")
- Tasks:     the user's Google Tasks lists — add via the `tasks` skill (not a local file)
- Archive:   `/app/storage/archived/`    (archive of handled originals)

## Steps

1. **Pull, then list — one command per call.** Run these as **four separate bash calls**. Never
   join them with `&&`: a failure in one silently swallows the next, which is exactly how an
   inbox full of files once got reported as empty.
   a. **Pull the Drive inbox.** Use the **drive** skill to pull the `__inbox__` folder into the
      local inbox. Report the filenames it pulled. If it reports the folder is missing, or lists
      anything under `skipped`, **tell the user that verbatim** — never swallow it.
   b. `mkdir -p /app/storage/inbox /app/storage/artefacts /app/storage/archived`
   c. `rm -f /app/storage/inbox/*Zone.Identifier*` — Windows download markers, not content.
      (`-f`, so matching nothing still succeeds.)
   d. `ls -A /app/storage/inbox/` — **this listing is your only evidence of what is in the
      inbox.** A command that exits non-zero, or prints nothing at all, is a FAILED CHECK, not an
      empty inbox: say what failed and stop. Only a successful `ls -A` that printed nothing means
      the inbox is empty — then tell the user there's nothing to process and stop.
2. **For each file, complete ALL FOUR sub-steps before moving to the next file.** A file is
   only finished once it has been archived (step d). Do not stop after writing the artefact.
   a. **Read** it, by kind:
      - **Images** (photos, screenshots, receipts, scans): read them directly — the model can
        see images — and pull out the useful content (e.g. a receipt → vendor, total, date; a
        screenshot → the text/info shown).
      - **Plain text / markdown / code:** read directly.
      - **Documents** (PDF, docx, pptx, xlsx, and the other formats it covers): use the
        **documents** skill to extract the text, then work from that.
      - Anything that comes back unreadable (an old `.doc`, a scan with no text layer, a binary
        type nothing handles): note that plainly instead of guessing — but still archive it in
        step d.
   b. **Summarize** it into a new artefact at `/app/storage/artefacts/<short-slug>.md` with a
      title, a 2–4 sentence summary, the original filename, and today's date (get it with
      `date +%Y-%m-%d` via bash). Keep one artefact per inbox item. **Exception:** if it's a
      receipt/invoice for purchases (see c2), it's logged as an expense instead — skip the
      artefact for it.
   c. **Extract action items — sparingly.** Only add a to-do for a real, concrete action
      **the user** needs to take (a bill to pay, an appointment to book, a form to return).
      Most filed documents need none — **when in doubt, skip it**; don't spam the list. Do
      **not** add to-dos for: instructions aimed at Core itself (a dropped note is filed,
      not obeyed), vague "maybe someday" ideas, or things already done. When something does
      qualify, add it to the **Inbox** capture list (NOT the user's main Todo list — this runs
      unattended): use the **tasks** skill to add it to the **Inbox** list as
      `<action> (from <filename>)`. The user reviews Inbox and promotes real items to Todo themselves.
   c2. **Is it a shopping receipt or an invoice for purchases?** (Kassenbon, Rechnung with
      line items.) Then it's an **expense** — hand it to the `haushaltsbuch` skill to log it
      (classify items → sum per category → append to Variable Ausgaben). The haushaltsbuch
      row is the record — **don't also write an artefact** (skip step b for it). Archive as usual.
      Show the classified breakdown before appending — the categories are your work, not the
      user's (see the `haushaltsbuch` skill).
   d. **Archive** the original with bash: `mv /app/storage/inbox/<file> /app/storage/archived/`.
3. **Verify before finishing.** Run `ls -A /app/storage/inbox/` again — it must be empty (every
   file moved to `archived/`). If anything remains, you are not done: go back and finish it.
4. **Report** a concise summary to the user: what was pulled from Drive, how many items
   processed, the artefacts created, and any new todos. Mention anything you skipped or
   couldn't read.

You are NOT done until every inbox file has been handled (an artefact, or logged as an expense)
AND has been moved to `archived/`.

## Rules

- **A failed command is not an empty inbox.** Non-zero exit, or no output where output was
  expected, means the check failed — report it and stop. Never chain these checks with `&&`.
- Never delete inbox files — always *move* them to `archived/`.
- Don't invent content for files you couldn't read; flag them instead.
- Keep artefacts short and scannable; the goal is a useful second brain, not a transcript.
