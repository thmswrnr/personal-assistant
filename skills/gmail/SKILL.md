---
name: gmail
description: Read the user's EMAIL (Gmail) and create draft replies — search, read, list labels, and save drafts. Use for email/mail requests ("check my email", "unread from Alice", "any mail from the bank?") and "draft a reply/email to…". Drafts are saved to Gmail, never sent. (Email — distinct from the local files inbox folder.)
metadata:
  {
    "core":
      { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } }
  }
---

# Gmail

Access the user's Gmail via a small CLI that calls the official Gmail API. It can
**search**, **read**, **list labels**, and **create drafts**. It **never sends** —
drafts are saved to Gmail for the user to review and send themselves.

## Commands (run via bash)

```bash
# Search (Gmail query syntax: is:unread, from:alice, newer_than:2d, subject:..., has:attachment)
node /app/.pi/skills/gmail/gmail.mjs search "is:unread newer_than:2d" 10

# Read one message in full (use an id from search results)
node /app/.pi/skills/gmail/gmail.mjs read <messageId>

# List labels
node /app/.pi/skills/gmail/gmail.mjs labels

# Create a DRAFT (saved to Gmail, never sent — the user reviews/sends it themselves)
node /app/.pi/skills/gmail/gmail.mjs draft --to "alice@example.com" --subject "Re: lunch" --body "Sounds good — see you at noon."
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
3. To draft a reply, `read` the original first so you can quote/answer it, then
   `draft` with a clear subject and body. Tell the user the draft is saved (not sent)
   and they can review/send it in Gmail.
4. **Never invent email content.** If a command errors (e.g. missing credentials),
   report that plainly rather than guessing.

## Setup (one time)

Requires `data/secrets/google_oauth.json` (the shared Google token — Gmail/Drive/Calendar/
YouTube). If it's missing, the user runs `node scripts/google-oauth.mjs` on the host once.
