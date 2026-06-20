---
name: gmail
description: Read AND manage the user's EMAIL (Gmail) — search, read, list labels, draft replies, send an approved draft, and change labels (mark read/unread, archive). Use for email/mail requests ("check my email", "unread from Alice", "any mail from the bank?"), "draft a reply/email to…", "send it", and "mark these read / archive that". Sending and label changes happen only on the user's explicit instruction. (Email — distinct from the local files inbox folder.)
metadata:
  {
    "core":
      { "requires": { "bins": ["node"], "files": ["/app/secrets/google_oauth.json"] } }
  }
---

# Gmail

Access and manage the user's Gmail via a small CLI that calls the official Gmail API. It
can **search**, **read**, **list labels**, **draft**, **send** an approved draft, and
**modify** labels (mark read/unread, archive). Reading is free to do; **sending and label
changes alter the user's real mailbox — do them only on the user's explicit instruction**
(see the Sending and Modifying sections below).

## Commands (run via bash)

```bash
# Search (Gmail query syntax: is:unread, from:alice, newer_than:2d, subject:..., has:attachment)
node /app/.pi/skills/gmail/scripts/gmail.mjs search "is:unread newer_than:2d" 10

# Read one message in full (use an id from search results)
node /app/.pi/skills/gmail/scripts/gmail.mjs read <messageId>

# List labels
node /app/.pi/skills/gmail/scripts/gmail.mjs labels

# Create a DRAFT (saved to Gmail, not sent — see "Sending" below for the approval flow)
node /app/.pi/skills/gmail/scripts/gmail.mjs draft --to "alice@example.com" --subject "Re: lunch" --body "Sounds good — see you at noon."

# SEND a draft the user has reviewed and explicitly approved (uses the draftId from `draft`)
node /app/.pi/skills/gmail/scripts/gmail.mjs send <draftId>

# MODIFY labels — mark read/unread, archive, star (only when the user asks)
node /app/.pi/skills/gmail/scripts/gmail.mjs modify <messageId> --read
node /app/.pi/skills/gmail/scripts/gmail.mjs modify <messageId> --archive
node /app/.pi/skills/gmail/scripts/gmail.mjs modify <messageId> --add STARRED --remove UNREAD
```

## Sending (draft → confirm → send)

Sending real email is **two deliberate steps**, never one:

1. Create the message with `draft` and show the user the full draft (to, subject, body).
2. **Only after the user explicitly approves THAT draft** (e.g. "yes, send it"), run
   `send <draftId>` with the id returned by `draft`. Never call `send` off your own
   judgement, never compose-and-send in one move, and never send during a scheduled/
   automated run. If the user hasn't clearly said to send, leave it as a draft.

## Modifying labels (mark read / archive)

`modify` changes the user's real mailbox. Run it **only when the user explicitly asks**
("mark these read", "archive that"). The Gmail watcher does **not** mark anything read on
its own — it only summarizes and notifies. (A future opt-in triage rule may auto-archive
obvious junk, but that's not active yet.)

### `watch` — for the scheduler, not for chat

`gmail.mjs watch` is a non-interactive poller used as a scheduler `watch` gate (see the
`schedule` skill), **not** something to run when chatting. It checks for new **unread
inbox** mail since it last ran (cursor in `/app/storage/state/gmail-watch.json`), exits
`0` only when something new appeared, and stages those messages to
`/app/storage/state/gmail-pending.json`. On a `0` exit the scheduler fires a Core run whose
prompt reads that pending file and summarizes/notifies. First run primes silently (records
the current unread backlog without firing).

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
   `draft` with a clear subject and body. Show the user the draft. To actually send it,
   follow the **Sending** flow above — only after they explicitly approve.
4. **Never invent email content.** If a command errors (e.g. missing credentials),
   report that plainly rather than guessing.

## Setup (one time)

Requires `data/secrets/google_oauth.json` (the shared Google token — Gmail/Drive/Calendar/
YouTube) with the `gmail.modify` and `gmail.send` scopes (for `modify` and `send`). If it's
missing or those scopes aren't granted, the user runs `node scripts/google-oauth.mjs` on the
host once and re-consents in the browser.
