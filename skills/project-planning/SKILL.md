---
name: project-planning
description: Break down a task, project, problem, or open-ended question into a clear, structured plan. Use when the user wants help thinking something through — "help me plan…", "break this down", "how do I/we…", "make a plan for…", "where do I start with…". Works for anything (technical or not), and saves real projects to their own folder so they don't clutter the main todo list.
metadata: {}
---

# Project planning

Help the user think a problem through and turn it into a **structured plan** — not a wall of
text, not a dump into their main todo list. Works for any kind of ask: a software project, a
trip, a decision, a "how do I get started with X" question.

## First: understand the ask
- If the goal or scope is fuzzy, **ask 1–2 sharp clarifying questions** before planning
  (timeframe, constraints, what "done" looks like). Don't interrogate — one good round.
- Judge the size:
  - **Quick / conceptual** ("how do I start learning X?", "what's the rough approach?") →
    just answer with a tight structured breakdown in chat. Offer to save it as a project if
    they'll come back to it. **Don't create files for a throwaway question.**
  - **A real, trackable project** (multi-step, they'll revisit it) → save it (next section).

## Saving a project
Give the project a short kebab-case slug (e.g. `bathroom-reno`, `learn-rust`, `tax-2026`).

```bash
slug="learn-rust"
mkdir -p "/app/storage/projects/$slug"
```

Write the plan to `/app/storage/projects/$slug/plan.md` with this shape (keep each part short):

```markdown
# <Project name>

**Goal:** one or two sentences — what success looks like.
**Constraints / unknowns:** time, budget, skills, open questions to resolve.

## Phases
### 1. <Phase>
- concrete step
- concrete step (→ depends on …)
### 2. <Phase>
- …

## Risks
- what could derail it + the mitigation

## Done when
- the checkable definition of finished
```

Then seed the **actionable** items into that project's *own* todo list — **not** the main one —
by pointing `todo.sh` at the project folder via `TODO_DIR`:

```bash
export TODO_DIR="/app/storage/projects/$slug"
todo.sh add "(A) Install the toolchain"
todo.sh add "Read the first three chapters due:2026-06-30"
todo.sh ls          # confirm
```

Other project files (notes, drafts, research) can live in the same `projects/$slug/` folder.

## Keeping it useful
- The plan is a living document — when the user makes progress or changes direction, update
  `plan.md` and the project's `todo.txt` (same `TODO_DIR` override) rather than starting over.
- To check on a project later: read its `plan.md` and run `TODO_DIR=/app/storage/projects/<slug> todo.sh ls`.
- Phases should be ordered and call out dependencies. Surface unknowns and risks honestly —
  a plan that hides the hard parts isn't useful.

## Rules
- **Don't pollute the main todo list** (`storage/todo.txt`) with project tasks — each project
  keeps its own (see the `todos` skill for the main list).
- Match effort to the ask: a quick question gets a quick structured answer, not a folder.
- Use `todo.sh` for the project's tasks too (never hand-edit todo.txt).
