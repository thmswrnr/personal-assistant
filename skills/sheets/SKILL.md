---
name: sheets
description: Read and write Google Sheets — create a spreadsheet, read a range, append rows, or overwrite cells. Use for "log this to a sheet", "add a row to my <X> spreadsheet", "what's in my <X> sheet", "start a spreadsheet for …", or any tracking/logging into Google Sheets.
metadata:
  { "openclaw": { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } } }
---

# Google Sheets

Read/write the user's Google Sheets via the Sheets v4 API. Reading is free; **writes change a
real spreadsheet — confirm with the user before appending/updating** (especially `update`,
which overwrites).

```bash
S="node /app/.pi/skills/sheets/sheets.mjs"

$S create "Expenses 2026"                       # new spreadsheet → prints id + url
$S find "Expenses"                               # locate existing sheets by name → id
$S tabs <id>                                      # tab/sheet titles (and the file title)
$S read <id> "A1:C20"                            # read a range (values as a 2D array)
$S append <id> "A1" 2026-06-16 Lunch 12.50       # append ONE row (cells as positional args)
$S append <id> "A1" --json '[["2026-06-17","Coffee","3.20"]]'   # append one or more rows
$S update <id> "B2" 42                            # overwrite a cell/range (positional or --json)
```

## Notes
- **Find first.** To work with an existing sheet, `find "<name>"` to get its `id`, then read/
  append. To start fresh, `create`. Tell the user the URL of anything you create.
- **Range**: `"Sheet1!A1:C20"` targets a tab explicitly; a bare `"A1"`/`"A:C"` targets the
  first tab. Use `tabs <id>` if you need the real tab names.
- Values are entered as if typed (`USER_ENTERED`) — numbers, dates, and `=formulas` parse
  naturally. `append` adds rows after existing data; `update` overwrites the given range.
- **No delete.** This skill can't delete a spreadsheet (by design — needs broader Drive
  permission). Tell the user to remove files from the Drive UI.
- If credentials are missing/lack the `spreadsheets` scope, the user runs
  `scripts/google-oauth.mjs`. Never fabricate cell contents.
