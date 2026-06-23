---
name: drive
description: Read the user's Google Drive (cloud storage) — list and search files/folders and read the text of Google Docs, Sheets, and plain-text files. Use for "find my … doc in Drive", "what's in my Drive", "read the … spreadsheet", "search my files for …". Read-only. (Google Drive cloud — distinct from the local files inbox folder.)
metadata:
  {
    "core":
      { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } }
  }
---

# Google Drive

Access the user's Google Drive via a small CLI that calls the official Drive API.
For your use it is **read-only** — `list`, `search`, and `read` only. Never create,
edit, move, or delete Drive files, even though the OAuth token now permits it: the
write capability exists solely for the automated `inbox-watch` poller (run by the
scheduler, not by you — see below). Treat Drive as read-only.

## Commands (run via bash)

```bash
# List the N most-recently-modified files (newest first; default 20)
node /app/.pi/skills/drive/scripts/drive.mjs list 20

# Find files by name or content (searches names + full text)
node /app/.pi/skills/drive/scripts/drive.mjs search "budget" 20
node /app/.pi/skills/drive/scripts/drive.mjs search "quarterly report" 20

# Read a file's text (use an id from list/search)
node /app/.pi/skills/drive/scripts/drive.mjs read <fileId>
```

Each command prints JSON.

- `list` / `search` return `{query, returned, files: [{id, name, mimeType, modified, owner, link}]}`.
- `read` returns `{id, name, mimeType, content}` for Google Docs (→ plain text),
  Sheets (→ CSV), and text files. For binary files (PDF, images, etc.) it returns
  `{…, note}` explaining it can't extract text — share the `link` instead.

## How to use it

1. Use `list` for "recent files"; use `search` to find a specific file by name or
   content. Pick the right `id` from the results before reading.
2. Only `read` a file when the user wants its contents. Content is capped (long files
   are truncated) to keep things lean — summarize rather than dumping it back verbatim.
3. **Never invent file names or contents.** If a command errors (e.g. missing
   credentials, or the Drive API not enabled), report that plainly instead of guessing.

## Drive `__inbox__` ingest (automated — not for interactive use)

A scheduler poller, `drive.mjs inbox-watch`, watches a Drive folder named `__inbox__`.
Each run it downloads every new **non-PDF** file into the local inbox
(`/app/storage/inbox/`) — where the `process-inbox` skill then handles it like any other
dropped file (artefact, todos, archive) — and **trashes** the Drive original so the
folder stays clear. PDFs are ignored for now and left in place. `inbox-list` prints the
folder's current contents for debugging. You do not call these — the scheduler does.

## Setup (one time)

Requires `data/secrets/google_oauth.json` with the full `drive` scope (read **and** write —
the ingest poller trashes processed files). If it's missing or only has `drive.readonly`,
the user runs `node scripts/google-oauth.mjs` on the host once (with the Drive API enabled
in their Google Cloud project) to re-consent.
