---
name: drive
description: Read the user's Google Drive (cloud storage) — list and search files/folders and read the text of Google Docs, Sheets, and plain-text files. Use for "find my … doc in Drive", "what's in my Drive", "read the … spreadsheet", "search my files for …". Read-only. (Google Drive cloud — distinct from the local files inbox folder.)
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } }
  }
---

# Google Drive

Access the user's Google Drive via a small CLI that calls the official Drive API.
It can **list**, **search**, and **read** files. It is **read-only** — it never
creates, edits, moves, or deletes anything.

## Commands (run via bash)

```bash
# List the N most-recently-modified files (newest first; default 20)
node /app/.pi/skills/drive/drive.mjs list 20

# Find files by name or content (searches names + full text)
node /app/.pi/skills/drive/drive.mjs search "budget" 20
node /app/.pi/skills/drive/drive.mjs search "quarterly report" 20

# Read a file's text (use an id from list/search)
node /app/.pi/skills/drive/drive.mjs read <fileId>
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

## Setup (one time)

Requires `data/secrets/google_oauth.json` with the `drive.readonly` scope. If it's
missing or lacks the scope, the user runs `node scripts/google-oauth.mjs` on the host
once (with the Drive API enabled in their Google Cloud project).
