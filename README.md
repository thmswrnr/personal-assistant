# Core — a self-hosted, model-agnostic personal assistant

Core is a self-hosted assistant: the [**pi**](https://github.com/earendil-works/pi) agent
harness in Docker, driving **any OpenAI-compatible LLM**, sharing a set of folders on your
machine. It reads and organizes your documents, keeps a "second brain," reaches services you
connect (Gmail, Drive, Calendar, YouTube, the web), runs recurring jobs on a schedule, and can
ping you on Telegram (one-way, via the `notify` skill) — all running on your own box. The harness is tiny, so it's happy on a
Raspberry Pi talking to a hosted API; if you'd rather self-host the model, point it at a local
server instead (see [`examples/local-models/`](examples/local-models/)).

> **Status:** working end-to-end. **Model-agnostic** — set an endpoint + key + model id (three
> values) and Core runs against any OpenAI-compatible API (hosted or self-hosted). `docker
> compose up -d` starts the stack; you drive Core through the `./core.sh` launcher. It has real tool-calling + thinking, ~35 skills, a built-in
> scheduler, and automatic context management. No GPU needed when you use a hosted API.

---

## Architecture

```
                         ┌───────────────────────────┐   OpenAI-compatible    ┌─────────────────────────┐
                         │ core  (pi harness + sched) │ ─────HTTPS (key)─────▶ │  Your LLM API           │
   ./core.sh ──exec────▶ │ Node 22 · read/write/edit/ │                        │  (hosted, or a local    │
                         │ bash · skills · scheduler  │                        │   server you run)       │
                         └─────────────┬──────────────┘                        └─────────────────────────┘
                                       │ volumes
              ┌────────────────────────┼──────────────┐
           data/pi   data/storage  data/secrets   skills/
           (config)   (your files)   (tokens)    (capabilities)
                                       │ http://searxng:8080  ┌──────────────────────┐
                                       └────────────────────▶ │ searxng (metasearch) │
                                                              └──────────────────────┘
```

- **`core`** — the pi harness. Talks to your model over an OpenAI-compatible API (endpoint +
  model in `data/pi/`, key in `.env`). Runs the **scheduler** as its main process and executes
  skills. Interactive/one-shot use attaches via `docker exec` (the `./core.sh` launcher).
- **`searxng`** — self-hosted, private metasearch (the `websearch` skill); no API key.

The model itself is **not** part of this stack — it's whatever OpenAI-compatible endpoint you
configure. To self-host one, [`examples/local-models/`](examples/local-models/) is a standalone
llama.cpp server you can run alongside Core or on another machine.

---

## Prerequisites

- Docker + Docker Compose
- An **OpenAI-compatible LLM endpoint** + API key. Any will do — a hosted provider, or a model
  you self-host (see [`examples/local-models/`](examples/local-models/)). For solid tool-calling
  + thinking, use a capable instruct model.
- No GPU required for Core itself (only if you choose to self-host the model).

---

## Setup

### 1. Point Core at your model — three values
This is the whole model setup. Core talks to one **generic OpenAI-compatible provider** (named
`api` in `data/pi/models.json`):

1. **Endpoint** — `data/pi/models.json` → the `api` provider's `baseUrl` (e.g.
   `https://api.your-provider/v1`). Self-hosting? Run
   [`examples/local-models/`](examples/local-models/) and point `baseUrl` at it.
2. **Key** — `.env` → `LLM_API_KEY=…` (kept out of version control; a self-hosted server
   ignores it).
3. **Model id** — list it under the `api` provider's `models[]`, and set
   `data/pi/settings.json` → `defaultModel` to it.

> Prefer one of pi's **built-in** providers (anthropic / openai / gemini / …)? You don't need
> the `api` entry at all — set that provider's standard key in `.env`, and put
> `"<provider>/<id>"` in `settings.json`. Confirm names with `pi --list-models`.

### 2. Environment
```bash
cp .env.example .env
# in .env:  LLM_API_KEY=...                       # your model API key
#           SEARXNG_SECRET=$(openssl rand -hex 32) # websearch container
```
`TELEGRAM_*` (for the `notify` skill) and per-skill keys are optional — see below.

### 3. Start
```bash
docker compose up -d --build       # builds + starts core + searxng (no local model service)
```

Optional integrations: **Google** (Gmail/Drive/Calendar/YouTube) — see "Integrating external
services"; **Telegram notifications** — see the `notify` skill; **self-hosted model** —
[`examples/local-models/`](examples/local-models/).

> `./setup.sh` automates the common path (`.env`, SearXNG secret, optional integrations, build
> & start) and is idempotent.

---

## Running — the `./core.sh` launcher

```bash
./core.sh                          # interactive chat, NEW session (/exit or Ctrl-C to quit)
./core.sh --continue               # resume your last interactive session (-c) instead of new
./core.sh "what's on my calendar?" # interactive, seeded with an opening message
./core.sh -p "summarize this: <url>"  # one-shot: print the answer and exit (stateless)
./core.sh skill morning-briefing   # run a skill (force-loads the full skill — most reliable)
./core.sh skill process-inbox      # process files dropped in data/storage/inbox/
```
Inside an interactive chat, `/new` starts a fresh session and `/resume` picks a past one
(pi built-ins). One-shot modes (`-p`, `skill`) are stateless — they save no session.
It starts the stack if needed and loads Core's context extensions (one `-e` each). The model is
whatever `data/pi/settings.json` selects (no `--model` flag needed).

### Under the hood (equivalent raw commands)
```bash
docker exec core_harness pi --list-models                                     # which models are configured?
# Core loads five small extensions, one dedicated concern each, via repeated -e:
EXTS="-e /app/.pi/extensions/spill-to-file.mjs -e /app/.pi/extensions/loop-guard.mjs -e /app/.pi/extensions/tool-call-guard.mjs -e /app/.pi/extensions/memory.mjs -e /app/.pi/extensions/memory-capture.mjs"
docker exec -it core_harness pi $EXTS                                          # uses settings.json default
docker exec core_harness pi -p "/skill:process-inbox" $EXTS
```

Stop: `docker compose down`.

---

## Folder layout

| Host path | In `core` | Purpose |
|---|---|---|
| `data/pi/` | `/app/.pi` | pi config: `models.json`, `SYSTEM.md`, `extensions/`, plus pi runtime (`sessions/`, …) |
| `data/storage/` | `/app/storage` | your files: `inbox/`, `artefacts/` (the second brain), `archived/`, `projects/` (per-project `plan.md` + `todos.md`), `schedule.json`, `memory/` (long-term facts), `custom_skills/` (Core's own writable skills — see `skill-builder`). The main to-do list lives in Google Tasks, not here. |
| `data/secrets/` | `/app/secrets` | OAuth creds / tokens (git-ignored) |
| `data/models/` | — | GGUF files, only if you self-host via `examples/local-models/` (unused by Core's stack) |
| `skills/` | `/app/.pi/skills` | `SKILL.md` capability packages (version-controlled) |
| `core/` | — | the core image (`Dockerfile`) + its runtime script (`scheduler/`) |
| `searxng/` | `/etc/searxng` (in `searxng`) | SearXNG config |

`data/` contents are git-ignored (only the authored config — `models.json`, `SYSTEM.md`, and the
`extensions/` source — is tracked). Your data, including `storage/memory/`, stays local.

---

## Skills

Skills are on-demand capability packages ([Agent Skills standard](https://agentskills.io/specification))
— a directory with a `SKILL.md` (frontmatter `name` + `description`, then instructions) plus
optional `scripts/` (executable code), `references/` (on-demand docs), and `assets/` subfolders,
in `skills/` (mounted to pi's config dir). Current skills:

| Skill | What it does |
|---|---|
| `gmail` | Read email (search / read / labels) **and create drafts** — never sends. Gmail API. |
| `drive` | Read Google Drive (list / search / read; Docs→text, Sheets→CSV). Read-only. |
| `calendar` | Google Calendar — list / agenda / today / search, **and create / edit / delete events** (confirms before writing). |
| `sheets` | Google Sheets — create a spreadsheet, read a range, append rows, overwrite cells. Confirms before writing. |
| `docs` | Google Docs — create a doc, read its text, append text. Confirms before writing. |
| `youtube` | Video transcripts (summarize any video) + your subscriptions & new-videos feed. |
| `weather` | Current conditions + forecast via Open-Meteo (no API key). |
| `overpass` | Find amenities/POIs near a place from OpenStreetMap ("pharmacies near X", ATMs/supermarkets/playgrounds nearby, opening hours) — geocodes via Nominatim + queries the free Overpass API (no key). Returns coordinates; pair with `google-maps` to visualize. |
| `google-maps` | Turn coordinates/places into a Google Maps link (one place, no key) or a Static Maps image with pins (several places + an optional highlighted spot; needs a Maps Platform key). Also **directions + travel time between two places** — driving/walking/cycling and **public transport** (trains, S-/U-Bahn, trams, buses; departure/arrival + line-by-line route) via the Directions API. Composable — Core uses it to visualize results from e.g. `overpass`. |
| `websearch` | Web search via the private SearXNG instance. |
| `web-read` | Fetch a URL and extract its main readable text (to summarize/answer from). |
| `browser` | Drive a fresh headless browser — open/click/fill/navigate via accessibility-ref snapshots (Playwright CLI). For interaction; sandboxed, logged-out. |
| `notify` | Send *you* a Telegram message (hard-limited to your chat). |
| `schedule` | Manage recurring jobs (list / add / remove cron jobs). |
| `process-inbox` | Read each file in `inbox/` (incl. **images** via vision) → note + todos → archive. |
| `morning-briefing` | Dated greeting + unread email + today's calendar + weather + a joke. |
| `tasks` | Multi-list task manager backed by **Google Tasks** (syncs to the Google Tasks app + Gmail/Calendar side panel) — routes by intent across your lists (Todo, Einkaufsliste/shopping, Inbox/capture); add / list / complete, due dates. |
| `project-planning` | Break any task/problem into a structured plan; saves real projects to their own `storage/projects/<slug>/` folder (`plan.md` + a plain-markdown `todos.md`). |
| `haushaltsbuch` | Log expenses to your `haushaltsbuch<year>` Google Sheet — classifies receipt items by category, sums per category, appends one row per category to the "Variable Ausgaben" tab. Markdown-only skill on top of `sheets`. |
| `skill-builder` | Lets Core author or modify its **own** skills — only on explicit request, shown for approval before writing, into the writable `custom_skills/` area (curated skills stay read-only). |
| `memory` | Save / recall / forget durable facts — and **auto-captures** them at the end of a chat (Core's long-term memory — see below). |
| `github-pages` | Publish a static site to GitHub Pages (create repo → push → enable Pages). Needs a PAT in `data/secrets/github_token`. |
| `sonos` | Control a Sonos speaker — play / pause / volume / favorites. Local network; set `SONOS_HOST` (the speaker IP) in `.env`. |
| `alan` | Ask the **Comma-Soft Alan** assistant (agentic LLM) and continue conversations. Streams the answer; pick a model (instant / thinking / GPT-5.4). Needs an API key in `data/secrets/alan_api_key`. |

**Engineering** (under `skills/engineering/`) — generic software-engineering workflows, wired to Core's tools (git/`gh`, Google `tasks`, `memory`, `notify`):

| Skill | What it does |
|---|---|
| `debug` | Structured debugging session — reproduce, isolate, diagnose, fix, prevent. |
| `code-review` | Review a diff/PR/file for security, performance, correctness, and maintainability. |
| `testing-strategy` | Design a test plan — pyramid balance, coverage targets, what to test vs skip. |
| `system-design` | Design systems/services — requirements, high-level design, scale, trade-offs. |
| `architecture` | Create or evaluate an Architecture Decision Record (ADR). |
| `tech-debt` | Identify, categorize, and prioritize technical debt with a scoring framework. |
| `documentation` | Write technical docs — README, API reference, runbook, architecture doc, onboarding. |
| `deploy-checklist` | Pre-deployment verification checklist with rollback triggers. |
| `incident-response` | Triage → communicate → mitigate → blameless postmortem. |
| `standup` | Generate a yesterday/today/blockers standup update from recent activity. |

> **Invoke skills with `/skill:<name>`** (or `./core.sh skill <name>`) for reliable execution.
> pi uses *progressive disclosure*: only a skill's description is always in context; the full
> `SKILL.md` loads on demand. Asked in plain language, a local model may act on the description
> alone and skip steps — `/skill:<name>` forces the full instructions in.

Add a skill by creating `skills/<name>/SKILL.md` (+ an optional CLI in `scripts/`) and `docker compose restart core`.

### Vision
If your model is multimodal, Core can *see* images: drop one in `data/storage/inbox/` and run
`process-inbox` (it reads receipts/screenshots/photos and files them), or point pi's `read` tool
at an image file.

---

## Subagents (parallel delegation)

Core can act as a **boss agent**: when a task splits into independent pieces (research several
sources at once, process several items), it decides on its own to hand them to **parallel
subagents**, then collects and synthesizes the results — you only ever talk to Core. This is
provided by the [`@tintinweb/pi-subagents`](https://www.npmjs.com/package/@tintinweb/pi-subagents)
pi extension (a Claude Code-style `Agent` tool), installed by `setup.sh` (pinned).

Unlike the bundled `extensions/` (loaded explicitly with `-e`, e.g. spill-to-file/memory), this is an
installed **pi package**: `setup.sh` runs `pi install` once, which registers it in
`data/pi/settings.json` so pi **auto-loads it on every run** — CLI and scheduled jobs alike.
No launcher flags needed. To (re)install by hand:

```bash
docker exec core_harness pi install npm:@tintinweb/pi-subagents@0.10.3
```

Delegation is the model's own call (guided by an instruction in `data/pi/SYSTEM.md`), so how
readily it happens tracks the boss model's judgement. Subagents are independent API calls, so
they run genuinely in parallel — the wall-clock win is real when your endpoint can serve
concurrent requests. By default they inherit Core's model; each agent in `data/pi/agents/` can
pin its own (e.g. a faster/cheaper id for the lightweight `fetch`/`Explore` workers).

---

## Memory (long-term)

Core runs are **stateless** — every command and scheduled job is a fresh `pi`
process. Long-term memory is how durable facts survive that: they're recorded as small files
under `data/storage/memory/` (one fact per file), with an auto-generated `MEMORY.md` **index**.

- The `memory.mjs` extension (loaded via its own `-e` on every entry point) injects the index
  into the system prompt on **every** run — zero tool calls, always present. Full fact files are
  read on demand only when relevant — the same *progressive disclosure* as skills, so context
  stays lean.
- The `memory` skill is the store: `save` / `forget` / `list`, with the index regenerated on
  every change (so it can't drift). You save a fact by asking ("remember that…").
- The `memory-capture.mjs` extension adds **autonomous capture**: at the end of an interactive
  session it runs a one-shot extraction pass (a fast Alan model, no tools, in a sub-process that
  can't recurse) over the conversation and *silently* saves any durable personal facts through
  the same store — deduped against the index and gated to skip one-offs/ephemeral details.
  Stateless one-shot / scheduled runs don't trigger it. Pruning stale facts stays a manual task
  (`memory forget`).

The payoff: a scheduled `notify` or a one-off command runs with your preferences and key facts
already in context — no re-asking, no stale assumptions.

---

## Context management (automatic)

To keep the model's context lean over long sessions:

- **Spill-to-file** (`data/pi/extensions/spill-to-file.mjs`) — big JSON tool output (search results, the
  subscriptions feed, …) is written to a file and replaced with a compact preview + path; the
  model queries it with `jq`. Deterministic, free, no extra model call.
- **Compaction** — handled natively by pi (`settings.compaction`): when the conversation grows
  long, older turns are summarized by the active model. pi tracks file operations in the summary
  so post-compaction context still knows what was read/edited; a custom cheap-model hook would
  discard that, so we leave compaction to pi.
- **Loop guard** (`data/pi/extensions/loop-guard.mjs`) — if the model issues the same tool call
  several times in a row with no new outcome, a corrective nudge is appended so it breaks out.
- **Tool-call guard** (`data/pi/extensions/tool-call-guard.mjs`) — if the model leaks a raw
  `<|tool_call|>` token as plain text (an upstream parse miss) instead of making a real tool
  call, a corrective nudge is injected so it retries; capped so it never loops.

---

## Scheduling

The `core` container runs a **scheduler** as its main process — it fires recurring jobs at set
times, with no dependency on anything external.

**Just ask Core** — it manages the schedule via the `schedule` skill:

> "Every morning at 7, run my briefing and save it as an email draft."
> "What's scheduled?" · "Stop the hourly email job."

Each job is a standard **cron** expression + a Core **prompt**, stored in
`data/storage/schedule.json` (reloaded live). What happens with the result is up to the prompt
— save an email draft, append to a note, `notify` you, etc. Output is also logged to
`docker logs core_harness`.

```json
[
  { "label": "Morning briefing", "cron": "0 7 * * *",
    "prompt": "Run the morning briefing and save it as a Gmail draft to myself." },
  { "label": "Weekday standup",  "cron": "30 8 * * 1-5",
    "prompt": "List today's calendar events and append them to a 'standup' note." }
]
```

cron = `minute hour day-of-month month day-of-week` (local time; set via `TZ` on the `core`
service, default `Europe/Berlin`). E.g. `0 7 * * *` daily 07:00, `30 8 * * 1-5` weekdays 08:30,
`0 * * * *` hourly, `*/15 * * * *` every 15 min. See `core/scheduler/schedule.example.json`.

---

## Telegram notifications (optional)

Core can ping you on Telegram via the `notify` skill (and scheduled jobs, e.g. the morning
briefing). This is **outbound-only** — there is no interactive bot. **Optional** — Core runs
fine without it.

1. Create a bot with **@BotFather**, put the token in `.env` as `TELEGRAM_BOT_TOKEN`.
2. Message your bot once, then read your chat id and set it in `.env` as `TELEGRAM_CHAT_ID`:
   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | grep -o '"chat":{"id":[0-9-]*'
   ```

Messages are **locked to your chat id**. (A two-way chat bridge previously existed and was
removed; a new one may be built later.)

---

## Integrating external services

How Core reaches the outside world. The pattern follows pi's design (and OpenClaw's): **a skill
documents a capability; the actual work is done by a tool the agent runs via `bash`.** No
built-in MCP.

Two kinds of skills:
- **Capability skills** wrap a service and ship a CLI — e.g. `gmail`, `drive`, `weather`.
- **Workflow skills** are just a `SKILL.md` (no script) orchestrating others — e.g.
  `morning-briefing`, `process-inbox`.

Adding a service, by case:

1. **Pure API (HTTP + JSON)** → a small **self-contained Node CLI** in the skill's `scripts/` folder (the
   image has `node`, `curl`, `jq` — **no rebuild**). The CLI holds the credential and calls the
   API, so the token never enters the model's context. Most skills are this case.
2. **A mature official CLI exists** (e.g. `gh`, `yt-dlp`) → install it in
   **`core/Dockerfile`** (pinned) and rebuild once; the `SKILL.md` documents how to call it.
   Already baked in: **`yt-dlp`** (youtube), **`gh`** (github-pages),
   **`sonos`** (sonos — compiled from source in a
   multi-stage build, since upstream ships macOS binaries only), and **`@playwright/cli` +
   headless WebKit** (browser). Most are tiny and
   harmless if unused; **WebKit is the one heavy add (~hundreds of MB)** — the cost of the
   `browser` skill. They're all installed regardless to keep setup simple.

Declare dependencies in `SKILL.md` frontmatter (OpenClaw-compatible):
```yaml
metadata:
  { "core": { "requires": { "bins": ["gh"], "env": ["GITHUB_TOKEN"] } } }
```
Credentials live in `data/secrets/` (git-ignored), read by the CLI — never through the model.
Prefer **read-only** scopes and least privilege.

### Google setup (one time) — Gmail, Drive, Calendar, YouTube

The Google skills share one OAuth token. In Google Cloud:

1. **Enable the APIs** you use: Gmail, Google Drive, Google Calendar, YouTube Data API v3.
   (A scope only appears in the consent screen's picker *after* its API is enabled.)
2. Create a **Web application** OAuth client, redirect URI `http://localhost:4100/oauth2callback`,
   and add the scopes: `gmail.readonly`, `gmail.compose` (drafts only — never sends),
   `drive.readonly`, `calendar.readonly`, `youtube.readonly`. Add yourself as a test user.
3. Download the client JSON to `data/secrets/google_client_secret.json`.

Then run on the host:
```bash
node scripts/google-oauth.mjs    # opens a consent URL; approve once
```
It writes `data/secrets/google_oauth.json` (one refresh token for all scopes) and **reports
which scopes were granted** — re-run it whenever you add a skill that needs a new scope.

---

## Adding or switching a model

Core is model-agnostic. Switching models is config-only — no code changes.

### The generic `api` provider (default path)
Edit three things, all in `data/pi/`:

1. **`models.json`** → the `api` provider's `baseUrl` (your OpenAI-compatible endpoint) and its
   `models[]` (each `id` is what the API expects; `reasoning: true` for thinking models,
   `input: ["text","image"]` only for multimodal).
2. **`.env`** → `LLM_API_KEY=…` (a self-hosted server ignores it; any value is fine).
3. **`settings.json`** → `defaultModel` = the id you want as the default.

Apply: `docker compose restart core`. Verify:
```bash
docker exec core_harness pi --list-models
docker exec core_harness pi -p "hi"
```

> **Tool calling** needs a model whose chat template supports tools (Gemma 3/4, Qwen3,
> Llama 3.1+, Mistral-Nemo, most hosted instruct models, …). Models without it *narrate* tool
> calls as text instead of executing them.

### A pi built-in provider (e.g. OpenAI, Anthropic, Gemini)
pi ships a provider catalog, so you can skip the `api` entry entirely: set that provider's
standard key in `.env` (e.g. `OPENAI_API_KEY`) and put `"<provider>/<id>"` in `settings.json`
`defaultModel`. Check exact names with `docker exec core_harness pi --list-models`.

### Self-hosting the model
Run [`examples/local-models/`](examples/local-models/) (a standalone llama.cpp server — same
machine or another), then set the `api` provider's `baseUrl` to it and `defaultModel` to its
alias. Same three knobs; the only difference is the endpoint is yours.

---

## Troubleshooting

- **Skill only half-runs / steps skipped** — invoke it as `/skill:<name>` so the full `SKILL.md`
  loads into context (see "Skills").
- **`EACCES` writing under `/app/.pi`** — leftover root-owned files from an earlier run:
  `docker exec -u 0 core_harness chown -R node:node /app/.pi`.
- **pi can't reach the model** — check the `api` provider's `baseUrl` in `models.json` and that
  `LLM_API_KEY` is set. Test directly: `docker exec core_harness pi --list-models` then
  `pi -p "hi"`. For a self-hosted endpoint, remember Core runs in a container — use
  `host.docker.internal` (same host) or the LAN IP, not `localhost`.
- **Model id mismatch** — the `id` in `models.json` / `defaultModel` must match what the API
  actually serves (for `examples/local-models/`, that's the `LLAMA_ARG_ALIAS`).
- **Auth errors (401/403)** — wrong or missing `LLM_API_KEY`, or a built-in provider whose key
  env var has a different name (check `pi --list-models`).
- **Agent narrates tool calls instead of running them** — the model lacks usable tool-calling.
  Use a function-calling-capable instruct model.
- **websearch errors** — the `searxng` container must be up and `SEARXNG_SECRET` set in `.env`.
