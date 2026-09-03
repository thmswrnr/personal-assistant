---
name: documents
description: Read the text of a DOCUMENT file — PDF, Word (docx), PowerPoint (pptx), Excel (xlsx), and also html, csv, json, xml, epub or zip. Use for "read this pdf", "what does this document/contract/invoice say", "summarize the Word file", "what's in the spreadsheet", and whenever a document lands in the inbox. (Documents on disk — images are read directly with the `read` tool, not here.)
metadata:
  { "core": { "requires": { "bins": ["/opt/doctools/bin/markitdown"] } } }
---

# Documents

Your `read` tool handles images and plain text only. Everything else — a PDF, a Word file, a
deck, a spreadsheet — comes through here: one command that prints the document as Markdown.

```bash
/opt/doctools/bin/markitdown /app/storage/inbox/rechnung.pdf
```

Read that output like any other text: summarize it, pull the numbers out of it, hand a receipt
to the `haushaltsbuch` skill.

## What it reads

| Type | Notes |
|------|-------|
| `.pdf` | The text layer. A scanned page has none — see below. |
| `.docx` | Paragraphs and headings. |
| `.pptx` | One block per slide, in slide order. |
| `.xlsx` | One Markdown table per sheet. |
| `.html` `.csv` `.json` `.xml` `.epub` `.zip` | Also handled, same command. |

Old pre-2007 formats (`.doc`, `.xls`, `.ppt`) are **not** supported. Say so; don't guess at the
contents.

## Empty output means empty text, not an empty document

A scanned PDF or a photographed page carries no text layer, so the command prints nothing. That
is a **result**, not a failure: tell the user the document has no extractable text and that it
looks like a scan. There is no OCR wired up yet (markitdown can do it through a vision model —
not enabled). **Never** describe a document you could not read: no guessing from the filename,
the folder it sat in, or what a file of that name usually contains.

## Rules

- One file per call. For several documents, run the command once per file.
- Quote the path — inbox filenames contain spaces.
- A non-zero exit is a real error (unreadable, encrypted, corrupt). Report what it printed
  instead of working around it.
- `sh: 1: blkid: not found` on stderr is harmless noise (a probe from one of the libraries; the
  image has no `blkid`). Ignore that line — the exit code is what tells you if it worked.
- Large documents: the whole text lands in your context. Pull out what the request needs and
  summarize the rest; don't paste the entire thing back to the user.
