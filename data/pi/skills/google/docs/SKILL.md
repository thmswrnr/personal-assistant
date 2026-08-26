---
name: docs
description: Read and write Google Docs — create a document, read its text, or append text. Use for "draft a doc about …", "start a Google Doc", "what does my <X> doc say", "add this to my <X> doc". For spreadsheets use `sheets`; to just read any Drive file's metadata use `drive`.
metadata:
  { "core": { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } } }
---

# Google Docs

Read/write the user's Google Docs via the Docs v1 API. Reading is free; **creating or appending
changes the user's Drive — confirm the gist with the user before writing.**

```bash
D="node /app/.pi/skills/google/docs/scripts/docs.mjs"

$D create "Meeting notes" --text "First line of the doc."   # new doc → prints id + url
$D find "Meeting notes"                                       # locate existing docs by name → id
$D read <id>                                                   # the document's plain text
$D append <id> "

A new paragraph added at the end."                            # append text at the end
```

## Notes
- **Find first** for existing docs (`find "<name>"` → `id`), or `create` a new one and give the
  user the URL.
- `read` returns plain text (paragraph text only — formatting, tables, and images are not
  reconstructed). Good for summarizing or answering from a doc.
- `append` inserts at the end; include a leading newline in the text if you want a new line/
  paragraph (as shown above). For long content, write it in one `append`.
- **No delete**, and no in-place editing of existing text beyond appending (by design — keeps
  it safe). Deleting/restructuring is done in the Docs UI.
- If credentials are missing/lack the `documents` scope, the user runs
  `scripts/google-oauth.mjs`. Never fabricate document contents.
