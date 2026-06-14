---
name: gmail
description: Read the user's Gmail — search messages, read a full message, list labels. Use when the user asks about their email, inbox, or a specific sender/subject. Read-only (cannot send, draft, or modify).
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["node"], "files": ["/app/secrets/gmail_oauth.json"] } }
  }
---

# Gmail (read-only)

Read the user's Gmail via a small CLI that calls the official Gmail API. It is
**read-only**: it can search and read mail and list labels, but cannot send,
draft, label, or delete anything.

## Commands (run via bash)

```bash
# Search (Gmail query syntax: is:unread, from:alice, newer_than:2d, subject:..., has:attachment)
node /app/.pi/skills/gmail/gmail.mjs search "is:unread newer_than:2d" 10

# Read one message in full (use an id from search results)
node /app/.pi/skills/gmail/gmail.mjs read <messageId>

# List labels
node /app/.pi/skills/gmail/gmail.mjs labels
```

Each command prints JSON. `search` returns
`{query, estimatedTotal, returned, messages: [{id, from, subject, date, snippet}]}` —
`estimatedTotal` is the approximate number of matches (often larger than `returned`, which
is capped by `maxResults`), so you can tell the user "~N total" without listing them all.
`read` returns `{from, to, subject, date, body}`.

## How to use it

1. Pick the right query from the user's request (e.g. "unread from my boss today" →
   `from:<boss> is:unread newer_than:1d`). Keep `maxResults` small (default 10).
2. Run `search`, then summarize senders/subjects for the user. Only `read` a full
   message when the user wants the contents of a specific one.
3. **Never invent email content.** If a command errors (e.g. missing credentials),
   report that plainly rather than guessing.

## Setup (one time)

Requires `data/secrets/gmail_oauth.json` (a read-only refresh token). If it's missing,
the user runs `node scripts/gmail-oauth.mjs` on the host once to create it.
