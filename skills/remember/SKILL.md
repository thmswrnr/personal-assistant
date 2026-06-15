---
name: remember
description: Save, update, or remove a durable fact in Core's long-term memory — things worth recalling across sessions (the user's preferences, key facts about them, ongoing projects, useful references). Use when the user says "remember that…", "from now on…", "forget that…", or when a clearly durable fact/preference emerges in conversation. NOT for one-off or ephemeral details.
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["node"] } }
  }
---

# Remember (long-term memory)

Core's memory is a folder of small fact files under `storage/memory/`, plus an auto-generated
`MEMORY.md` index that is loaded into **every** run (interactive, scheduled, and Telegram).
That means a fact saved here is available to all future runs — including stateless ones like a
scheduled notification — without anyone having to re-explain it.

The index lists each fact's description. When a description looks relevant to the current
request, **read that fact's file** (`storage/memory/<slug>.md`) for the full detail before
relying on it.

## Commands (run via bash)

```bash
# Save (or update) a fact. --slug is a stable kebab-case id; re-saving the same slug overwrites it.
node /app/.pi/skills/remember/remember.mjs save \
  --slug user-city \
  --type user \
  --desc "where the user lives — base for weather, commute, briefings" \
  --body "Bonn, Germany."

# Remove a fact
node /app/.pi/skills/remember/remember.mjs forget --slug user-city

# Show the current index
node /app/.pi/skills/remember/remember.mjs list
```

`--type` is one of: `user` (who they are), `preference` (how they like things done),
`project` (ongoing work/goals), `reference` (a pointer/link/resource).

## How to use it

1. **What to save:** durable, reusable facts — preferences ("no jokes in the briefing"),
   stable facts about the user (city, role, key people), ongoing projects, and references
   (a dashboard URL, an account id). Keep each fact to one focused idea; the `--body` should
   be a short, self-contained statement.
2. **Be specific in `--desc`.** It's the line the future agent sees in the index and uses to
   decide whether to open the file — make it say what the fact is *for*.
3. **One fact per slug; update, don't duplicate.** If a fact already exists, re-`save` the
   same slug to correct it instead of creating a near-duplicate. Convert relative dates to
   absolute ones (e.g. "next Friday" → the actual date) so they don't rot.
4. **Forget when asked** ("forget my old address") or when a fact becomes wrong.
5. **Confirm briefly** in plain language ("Got it — I'll remember you're in Bonn"). If unsure
   whether something is worth remembering, ask.
6. **Never store secrets.** The index is loaded into context on *every* run, so memory must
   never hold passwords, passphrases, PINs, door/locker codes, API tokens, or keys. Refuse to
   `save` those — even if asked — and say why; use the secret for the task at hand but don't
   persist it. Secrets belong in `/app/secrets/` (read inline, never echoed), not in memory.
