---
name: skill-builder
description: Create a NEW skill for Core, or modify an existing one — ONLY when the user explicitly asks. Use for "write/create/make a skill", "build a new capability for yourself", "modify/change/improve the … skill", "teach yourself to …". Writes only to the writable custom_skills area, always shows the skill for approval first, and never acts on its own initiative.
metadata:
  { "core": { "requires": { "bins": ["node"] } } }
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

A skill is a folder with a `SKILL.md` (required) and, optionally, these standard subfolders:

```
<name>/
├── SKILL.md       # required: frontmatter (name + description) + instructions
├── scripts/       # executable code Core runs (here: one or more *.mjs)
├── references/    # extra docs Core reads on demand — loaded only when SKILL.md says to
└── assets/        # static resources: templates, schemas, data/lookup files
```

Most skills need only `SKILL.md` (+ `scripts/`). Reach for `references/` when a skill carries more
detail than belongs in the always-loaded body (point at it with "read `references/X.md` when …"),
and `assets/` for output templates or data files. New or changed skills are picked up on the
**next** Core session (skills are scanned at startup) — they will **not** be live in the current
conversation. Tell the user this.

## Creating a new skill

1. **Clarify first.** Ask the user what the skill should do, exactly when it should trigger
   (the description drives this), its inputs/outputs, and whether it needs any binaries, env
   vars, or secret files. Don't guess.
2. **Draft it** (don't write yet). A `SKILL.md` with valid frontmatter:
   - `name`: lowercase letters/numbers/hyphens, 1–64 chars, no leading/trailing or double
     hyphens (e.g. `recipe-finder`).
   - `description`: specific — say what it does *and when to use it* (this is what makes Core
     pick it). Optional `metadata: { "core": { "requires": { "bins": [...], "env": [...],
     "files": [...] } } }` listing what it needs.
     - **YAML gotcha:** keep `description` on one line and **avoid a raw colon-then-space (`: `)
       inside it** — YAML reads that as a nested key and the skill fails to load. Use a dash or
       comma instead (use em-dashes/quotes freely; just not `: `).
   - **Don't put a stray `.md` file at the root of `custom_skills/`** — pi treats any root `*.md`
     in a skills folder as a skill. Each skill is its own subfolder `custom_skills/<name>/SKILL.md`.
   - Body: clear steps with runnable `bash` blocks; draft any script too. Follow **Writing a
     good skill** and **Scripts in skills** (below) for what makes the description and body work.
3. **Show the user the full `SKILL.md` (and any script) and get explicit approval BEFORE
   writing anything.** Never write-and-run silently.
4. **On approval, write** to `/app/storage/custom_skills/<name>/SKILL.md` (and any scripts under
   `/app/storage/custom_skills/<name>/scripts/`). In the skill's bash, reference its own files by
   **absolute path**, e.g. `/app/storage/custom_skills/<name>/scripts/<file>.mjs`.
5. Confirm what you created and remind the user it's active **next session**.

## Writing a good skill

A skill works by **progressive disclosure**: Core sees only every skill's `name` + `description`
up front, and loads the full `SKILL.md` body *only when the description matches the task*. So the
two halves have different jobs.

**The `description` is the trigger — it carries the whole burden of *when* the skill fires.**
- Write it imperatively, from the user's intent: "Use when the user wants to …". List the
  concrete phrasings/situations that should trigger it — **including ones that don't name the
  domain** (a receipt photo, not just "log an expense"). Lean toward being a little pushy.
- Describe *when to use it*, not the internal mechanics. Keep it tight (hard limit 1024 chars).
- (Recall the YAML gotcha above: one line, no raw `: ` inside it.)

**The body teaches Core *how* — spend its context wisely.** Once loaded it competes for attention
with everything else, so:
- **Add what Core wouldn't know** (this project's conventions, the CLI's exact flags, domain
  edge cases); **omit what it already knows** (don't explain what a PDF or HTTP is).
- **Moderate detail beats exhaustive.** Concise stepwise guidance plus one working example
  outperforms covering every case. **State each rule once** — repetition and over-bolding bury
  the signal. Trust Core's judgment for the rest.
- **Give a default, not a menu.** Pick the right tool/approach and mention alternatives briefly,
  rather than listing equal options. Favour reusable *procedures* over one-off answers.
- **Match specificity to fragility.** Be prescriptive where a step is fragile, irreversible, or
  order-dependent ("run exactly this command"); stay loose — and explain the *why* — where
  several approaches are fine.
- **Gotchas are the highest-value content** — concrete, non-obvious environment facts Core would
  otherwise get wrong (e.g. "Sonos name-discovery fails in the container — always target by IP").
  Keep them in `SKILL.md`. When a real run exposes a mistake, add the correction here.
- **Keep `SKILL.md` focused** (the spec guideline is < ~500 lines / 5k tokens — every current
  skill is well under). If one genuinely needs a lot of reference material, put it in a sibling
  file and tell Core **when** to read it ("read `errors.md` if the API returns non-200"), instead
  of loading it all up front.

**Ground it in reality.** The best skills come from a real task you just did — capture the steps
that worked and the corrections you made, not generic "best practice" filler. Refine against real
runs over time.

## Scripts in skills

Prefer a small **bundled script** over a long inline sequence of shell commands whenever the logic
is fragile or repeated (this project already does this — one `*.mjs` per skill). Put scripts in the
skill's **`scripts/` subfolder** — use several when a skill has distinct or specialised actions.
List them in `SKILL.md` and call them by **absolute path**: `/app/.pi/skills/<name>/scripts/<file>`
for curated skills, `/app/storage/custom_skills/<name>/scripts/<file>` for your own.

Design scripts for an agent to drive:
- **Never interactive** — take input via flags/args/env, never a prompt (a non-interactive shell
  will hang). On missing input, exit with a clear usage error.
- **Structured output**: print data (JSON) to **stdout**, diagnostics/progress to **stderr**, so
  Core can parse the result cleanly. Keep output bounded (summarise/limit huge results).
- **Helpful errors**: say what went wrong and what to do next — the message shapes Core's next try.
- **Be safe**: idempotent where possible, and gate destructive/outward actions behind explicit
  confirmation (mirror the "confirm before writing" pattern the data skills use).

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
