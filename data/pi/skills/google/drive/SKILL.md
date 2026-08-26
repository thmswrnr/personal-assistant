---
name: drive
description: Access the user's Google Drive (cloud storage) — list and search files/folders, read the text of Google Docs/Sheets/text files, and write (upload) a file to Drive. Use for "find my … doc in Drive", "what's in my Drive", "read the … spreadsheet", "search my files for …", and "save/dump/put this in (my) Drive / the … folder". Reads anything; writes by uploading new files (never deletes or overwrites). (Google Drive cloud — distinct from the local files inbox folder.)
metadata:
  {
    "core":
      { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } }
  }
---

# Google Drive

Access the user's Google Drive via a small CLI that calls the official Drive API.
You may **read** freely (`list`, `search`, `read`) and **write by uploading new files**
(`write`). You must **never delete, trash, move, or overwrite** existing Drive files —
`write` only ever *creates* a new file. The one exception is `inbox-pull`, which trashes the
Drive originals it has already copied into the local inbox. See below.

## Commands (run via bash)

```bash
# List the N most-recently-modified files (newest first; default 20)
node /app/.pi/skills/google/drive/scripts/drive.mjs list 20

# Find files by name or content (searches names + full text)
node /app/.pi/skills/google/drive/scripts/drive.mjs search "budget" 20
node /app/.pi/skills/google/drive/scripts/drive.mjs search "quarterly report" 20

# Read a file's text (use an id from list/search)
node /app/.pi/skills/google/drive/scripts/drive.mjs read <fileId>

# Write (upload) a local file to Drive — e.g. dump a generated artefact
node /app/.pi/skills/google/drive/scripts/drive.mjs write /app/storage/artefacts/report.md
node /app/.pi/skills/google/drive/scripts/drive.mjs write /tmp/out.csv --name "Q3 figures.csv" --folder "Reports"

# Pull the Drive __inbox__ folder into the local inbox (see below)
node /app/.pi/skills/google/drive/scripts/drive.mjs inbox-list
node /app/.pi/skills/google/drive/scripts/drive.mjs inbox-pull
```

Each command prints JSON.

- `list` / `search` return `{query, returned, files: [{id, name, mimeType, modified, owner, link}]}`.
- `read` returns `{id, name, mimeType, content}` for Google Docs (→ plain text),
  Sheets (→ CSV), and text files. For binary files (PDF, images, etc.) it returns
  `{…, note}` explaining it can't extract text — share the `link` instead.
- `write` returns `{uploaded, folder, id, link}` (plus `folderCreated: true` if it had to
  make the folder). Report the `folder` and `link` back to the user.

## Writing to Drive

`write <localPath>` uploads an existing local file (an artefact in `/app/storage`, or scratch
in `/tmp`) as a **new** Drive file. Typical flow when the user says "dump/save this to Drive":
produce the file locally first (e.g. with the `write` tool into `/app/storage/artefacts/…`),
then upload it.

- **Which folder?** Pass `--folder "<name>"` to target any folder (matched by name; **created
  if it doesn't exist**). Without `--folder`, the file lands in **My Drive root**.
- **No forced default.** This skill has no built-in dump folder. If the user has a preferred
  default location for "just put it in Drive" (with no folder named), that's their personal
  convention — **check long-term memory** for it and use `--folder` accordingly. If the user
  *names* a folder, always honour that over any default.
- `--name` overrides the Drive file name (defaults to the local basename); `--mime` overrides
  the content type (otherwise inferred from the extension).
- **Create only.** Never delete, trash, move, or overwrite existing Drive files. Uploading a
  same-named file creates a second copy — if the user wants to "update" a file, tell them this
  creates a new copy rather than silently doing it.

## How to use it

1. Use `list` for "recent files"; use `search` to find a specific file by name or
   content. Pick the right `id` from the results before reading.
2. Only `read` a file when the user wants its contents. Content is capped (long files
   are truncated) to keep things lean — summarize rather than dumping it back verbatim.
3. **Never invent file names or contents.** If a command errors (e.g. missing
   credentials, or the Drive API not enabled), report that plainly instead of guessing.

## Drive `__inbox__` ingest (`inbox-pull`)

`drive.mjs inbox-pull` empties a Drive folder named `__inbox__` into Core. It downloads every
**non-PDF** file into the local inbox (`/app/storage/inbox/`) and **trashes** the Drive original
so the folder stays clear. PDFs are ignored for now and left in place. It prints
`{folder, localInbox, ingested, skipped?}`; an empty folder gives an empty `ingested` list, which
is a normal result, not an error.

Run it when the user asks to pull in, fetch, or ingest their Drive inbox ("get the files I put in
Drive"). Follow it with `/skill:process-inbox` to actually handle what landed (artefact, todos,
archive) — `inbox-pull` only moves the files across.

`inbox-list` prints the Drive folder's current contents without touching anything.

## Setup (one time)

Requires `data/secrets/google_oauth.json` with the full `drive` scope (read **and** write —
`inbox-pull` trashes the files it has copied). If it's missing or only has `drive.readonly`,
the user runs `node scripts/google-oauth.mjs` on the host once (with the Drive API enabled
in their Google Cloud project) to re-consent.
