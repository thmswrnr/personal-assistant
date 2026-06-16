---
name: skill-builder
description: Create a NEW skill for Core, or modify an existing one — ONLY when the user explicitly asks. Use for "write/create/make a skill", "build a new capability for yourself", "modify/change/improve the … skill", "teach yourself to …". Writes only to the writable custom_skills area, always shows the skill for approval first, and never acts on its own initiative.
metadata:
  { "openclaw": { "requires": { "bins": ["node"] } } }
---

# Skill Builder

Lets Core extend itself by authoring or editing skills. **This is powerful — a skill can contain
code that Core later runs — so it is tightly gated.**

## Hard rule — explicit request only

**Only ever use this skill when the user explicitly asks you to create, modify, or remove a
skill.** Never invent, edit, or enable a skill on your own initiative, as a side-effect of
another task, or because it "would be helpful". If you merely *think* a new skill would help,
*suggest* it in plain words and stop — do not build it unless the user says to.

## Where skills live

- **Curated skills:** `/app/.pi/skills/…` — **READ-ONLY. Never write here.** These are managed by
  the user via Claude Code. You cannot and must not change them in place.
- **Your writable area:** `/app/storage/custom_skills/<name>/` — this is the *only* place you
  write skills. New skills and your own edits go here.

A skill is a folder with a `SKILL.md` (required) plus any helper scripts/assets. New or changed
skills are picked up on the **next** Core session (skills are scanned at startup) — they will
**not** be live in the current conversation. Tell the user this.

## Creating a new skill

1. **Clarify first.** Ask the user what the skill should do, exactly when it should trigger
   (the description drives this), its inputs/outputs, and whether it needs any binaries, env
   vars, or secret files. Don't guess.
2. **Draft it** (don't write yet). A `SKILL.md` with valid frontmatter:
   - `name`: lowercase letters/numbers/hyphens, 1–64 chars, no leading/trailing or double
     hyphens (e.g. `recipe-finder`).
   - `description`: specific — say what it does *and when to use it* (this is what makes Core
     pick it). Optional `metadata: { "openclaw": { "requires": { "bins": [...], "env": [...],
     "files": [...] } } }` listing what it needs.
   - Body: clear steps, with runnable `bash` blocks. If it needs a script, draft that too.
3. **Show the user the full `SKILL.md` (and any script) and get explicit approval BEFORE
   writing anything.** Never write-and-run silently.
4. **On approval, write** to `/app/storage/custom_skills/<name>/SKILL.md` (and scripts in the
   same folder). In the skill's bash, reference its own files by **absolute path**
   `/app/storage/custom_skills/<name>/<file>`.
5. Confirm what you created and remind the user it's active **next session**.

## Modifying one of your own skills (already in custom_skills)

Read the current `/app/storage/custom_skills/<name>/SKILL.md`, propose the change, **show the new
version for approval**, then `edit`/`write` it in place. Active next session.

## "Modify a built-in" → copy it out under a NEW name

A custom skill **cannot override a built-in of the same name** (the read-only original wins). So
to evolve a curated skill:

1. Copy the whole folder: `cp -r /app/.pi/skills/<orig>/ /app/storage/custom_skills/<new-name>/`
   — pick a **new** `<new-name>` (e.g. `weather-plus`).
2. In the copy's `SKILL.md`, set `name:` to `<new-name>`, and **rewrite every internal path**
   from `/app/.pi/skills/<orig>/…` to `/app/storage/custom_skills/<new-name>/…` (scripts moved
   with the copy).
3. Make the requested change, show it for approval, write it.
4. Tell the user the **original built-in still exists** alongside the new one (it isn't
   replaced).

## Listing / removing

- List your custom skills: `ls /app/storage/custom_skills`.
- Remove one **only if asked**: `rm -rf /app/storage/custom_skills/<name>` (confirm first).

## Safety recap

Explicit request only · show for approval before writing · write only under
`/app/storage/custom_skills/` · never touch `/app/.pi/skills` · never write-and-run silently.
