# Core — a self-hosted, model-agnostic personal assistant

Core is a self-hosted assistant: the [**pi**](https://github.com/earendil-works/pi) agent
harness in Docker, driving **any OpenAI-compatible LLM**, sharing a set of folders on your
machine. It reads and organizes your documents, keeps a "second brain," reaches services you
connect (Gmail, Drive, Calendar, YouTube, the web), and can ping you on Telegram (one-way, via
the `notify` skill) — all running on your own box. It does nothing on its own: it acts only when
you ask it to. The harness is tiny, so it's happy on a
Raspberry Pi talking to a hosted API; if you'd rather self-host the model, point it at a local
server instead.

---

## Prerequisites

- Docker + Docker Compose
- An **OpenAI-compatible LLM endpoint** + API key. Any will do — a hosted provider, or a model
  you self-host (llama.cpp, vLLM, LM Studio, …). For solid tool-calling + thinking, use a
  capable instruct model.
- No GPU required for Core itself (only if you choose to self-host the model).

---

## Setup

### 1. Point Core at your model — three values
This is the whole model setup. Core talks to one **generic OpenAI-compatible provider** (named
`api` in `data/pi/models.json`):

1. **Endpoint** — `data/pi/models.json` → the `api` provider's `baseUrl` (e.g.
   `https://api.your-provider/v1`). Self-hosting? Run your own OpenAI-compatible server and
   point `baseUrl` at it.
2. **Key** — `.env` → `LLM_API_KEY=…` (kept out of version control; a self-hosted server
   ignores it).
3. **Model id** — list it under the `api` provider's `models[]`, and set
   `data/pi/settings.json` → `defaultModel` to it.

> Using a pi **built-in** provider (anthropic / openai / gemini / …) or self-hosting a model?
> See [Adding or switching a model](#adding-or-switching-a-model).

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

On a machine that also runs the home-automation side (a Raspberry Pi with a Zigbee stick), add
the `home` profile to bring up Home Assistant alongside it — set `ZIGBEE_DEVICE` in `.env` first:
```bash
docker compose --profile home up -d --build
```

Optional integrations: **Google** (Gmail/Drive/Calendar/YouTube, plus a Maps Platform key for
static maps & directions in `google-maps`) — see "Integrating external services"; **Telegram
notifications** — see the `notify` skill.

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
It starts the stack if needed (`docker exec`s into `core_harness`, loading Core's context
extensions via repeated `-e`) and uses the model `data/pi/settings.json` selects (no `--model`
flag needed). Stop: `docker compose down`.

### Call it from anywhere

Symlink the launcher onto your `PATH` once, and `core` works from any directory — handy when you
ssh into the box it runs on:

```bash
sudo ln -s "$(pwd)/core.sh" /usr/local/bin/core

core -p "what's on my calendar?"   # from any directory
ssh <host> core -p "any new mail?" # and over a non-interactive ssh
```

A symlink (not a shell alias) is what makes the `ssh` form work — an alias only exists in
interactive shells. The launcher resolves the link with `readlink -f`, so it always finds the
repo it lives in.

---

## Folder layout

| Host path | In `core` | Purpose |
|---|---|---|
| `data/pi/` | `/app/.pi` | pi config: `settings.json`, `models.json`, `SYSTEM.md`, `extensions/`, `agents/`, `skills/`, plus pi runtime (`sessions/`, `npm/`, …) |
| `data/storage/` | `/app/storage` | your files: `inbox/`, `artefacts/` (the second brain), `archived/`, `projects/` (per-project `plan.md` + `todos.md`), `memory/` (long-term facts), `custom_skills/` (Core's own writable skills — see `skill-builder`). The main to-do list lives in Google Tasks, not here. |
| `data/secrets/` | `/app/secrets` | OAuth creds / tokens (git-ignored) |
| `data/searxng/` | `settings.yml` → `/etc/searxng/settings.yml` (in `searxng`) | SearXNG config |
| `data/homeassistant/` | `/config` (in `homeassistant`) | Home Assistant's config, state and secrets (git-ignored) |
| `core/` | — | the core image (`Dockerfile`) |

**Everything a container mounts lives under `data/`.** Its contents are git-ignored, apart from
the authored config that is whitelisted back in: `settings.json`, `models.json`, `SYSTEM.md`, the
`extensions/` source, `agents/`, `skills/`, and `searxng/settings.yml`. Your data, including
`storage/memory/`, stays local.

`settings.json` carries the model defaults and the installed-package list, so a clone is
correctly wired before `setup.sh` runs. pi also rewrites `theme` and `lastChangelogVersion` in
it, which shows up as occasional working-tree churn — commit or discard as you like.

---

## Skills

Skills are on-demand capability packages ([Agent Skills standard](https://agentskills.io/specification))
— a directory with a `SKILL.md` (frontmatter `name` + `description`, then instructions) plus
optional `scripts/` (executable code), `references/` (on-demand docs), and `assets/` subfolders,
grouped into category folders under `data/pi/skills/` (`assistant/`, `google/`, `home/`, `web/`,
`engineering/`; pi's config dir). Folders are just for organization — skills are
invoked by `name`, not path. Current skills:

| Skill | What it does |
|---|---|
| `gmail` | Read email (search / read / labels), **create drafts**, **send a draft you approved**, and **triage** (mark read/unread, label, archive). Sending & label changes only on your explicit instruction. Gmail API. |
| `drive` | Read Google Drive (list / search / read; Docs→text, Sheets→CSV). |
| `calendar` | Google Calendar — list / agenda / today / search, **and create / edit / delete events** (confirms before writing). |
| `sheets` | Google Sheets — create a spreadsheet, read a range, append rows, overwrite cells. Confirms before writing. |
| `docs` | Google Docs — create a doc, read its text, append text. Confirms before writing. |
| `youtube` | Video transcripts (summarize any video) + your subscriptions & new-videos feed. |
| `weather` | Current conditions + forecast via Open-Meteo (no API key). |
| `home-assistant` | Read and control the home automation — lights, switches, sensors, climate, covers, locks. Local network; needs a long-lived token in `data/secrets/ha_token`. |
| `overpass` | Find amenities/POIs near a place from OpenStreetMap ("pharmacies near X", ATMs/supermarkets/playgrounds nearby, opening hours) — geocodes via Nominatim + queries the free Overpass API (no key). Returns coordinates; pair with `google-maps` to visualize. |
| `google-maps` | Turn coordinates/places into a Google Maps link (one place, no key) or a Static Maps image with pins (several places + an optional highlighted spot; needs a Maps Platform key). Also **directions + travel time between two places** — driving/walking/cycling and **public transport** (trains, S-/U-Bahn, trams, buses; departure/arrival + line-by-line route) via the Directions API. Composable — Core uses it to visualize results from e.g. `overpass`. |
| `websearch` | Web search via the private SearXNG instance. |
| `web-read` | Fetch a URL and extract its main readable text (to summarize/answer from). |
| `notify` | Send *you* a Telegram message (hard-limited to your chat). |
| `process-inbox` | Read each file in `inbox/` (incl. **images** via vision) → note + todos → archive. |
| `morning-briefing` | Dated greeting + unread email + today's calendar + weather + a joke. |
| `tasks` | Multi-list task manager backed by **Google Tasks** (syncs to the Google Tasks app + Gmail/Calendar side panel) — routes by intent across your lists (Todo, Einkaufsliste/shopping, Inbox/capture); add / list / complete, due dates. |
| `project-planning` | Break any task/problem into a structured plan; saves real projects to their own `storage/projects/<slug>/` folder (`plan.md` + a plain-markdown `todos.md`). |
| `haushaltsbuch` | Log expenses to your `haushaltsbuch<year>` Google Sheet — classifies receipt items by category, sums per category, appends one row per category to the "Variable Ausgaben" tab. Markdown-only skill on top of `sheets`. |
| `skill-builder` | Lets Core author or modify its **own** skills — only on explicit request, shown for approval before writing, into the writable `custom_skills/` area (curated skills stay read-only). |
| `memory` | Save / recall / forget durable facts — and **auto-captures** them at the end of a chat (Core's long-term memory — see below). |
| `github-pages` | Publish a static site to GitHub Pages (create repo → push → enable Pages). Needs a PAT in `data/secrets/github_token`. |

**Engineering** (under `data/pi/skills/engineering/`) — generic software-engineering workflows, wired to Core's tools (git/`gh`, Google `tasks`, `memory`, `notify`):

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

Add a skill by creating `data/pi/skills/<category>/<name>/SKILL.md` (+ an optional CLI in `scripts/`) and `docker compose restart core`.

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
`data/pi/settings.json` so pi **auto-loads it on every run** — interactive and one-shot alike.
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

Core runs are **stateless** — every command is a fresh `pi` process. Long-term memory is how durable facts survive that: they're recorded as small files
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
  Stateless one-shot runs don't trigger it. Pruning stale facts stays a manual task
  (`memory forget`).

The payoff: every command runs with your preferences and key facts already in context — no
re-asking, no stale assumptions.

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

## Always on (no timers)

Core never acts on its own — there is no scheduler and nothing runs on a clock. It does exactly
what you ask, when you ask it.

It is still **always reachable**. The `core` container's main process is a keep-alive, so the
container stays open as a warm shell that `core.sh` enters with `docker exec`; both services use
`restart: unless-stopped`, so the stack comes back after a reboot or a crash. That is what makes
a Raspberry Pi you ssh into at any hour a good home for it.

> Want something to happen at a set time? Use your OS. A `cron` entry or a systemd timer on the
> host that runs `./core.sh -p "…"` or `./core.sh skill morning-briefing` gives you the same
> result, with the scheduling owned by the machine rather than by Core.

---

## Telegram notifications (optional)

Core can ping you on Telegram via the `notify` skill. This is **outbound-only** — there is no interactive bot. **Optional** — Core runs
fine without it.

1. Create a bot with **@BotFather**, put the token in `.env` as `TELEGRAM_BOT_TOKEN`.
2. Message your bot once, then read your chat id and set it in `.env` as `TELEGRAM_CHAT_ID`:
   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | grep -o '"chat":{"id":[0-9-]*'
   ```

Messages are **locked to your chat id**.

---

## Talking to Core through Home Assistant (optional)

Two separate links, one in each direction.

**Core → the house** is the `home-assistant` skill: HA's REST API, a long-lived token in
`data/secrets/ha_token`. Core can list entities, read one, and call a service.

**The house → Core** is the `core_bridge` service. Home Assistant's built-in Ollama conversation
agent is the only maintained one that accepts an arbitrary server URL, so the bridge imitates an
Ollama server — `GET /api/tags` and `POST /api/chat`, NDJSON, streamed. Behind it sits one
long-lived `pi --mode rpc` process, loading the same extensions `core.sh` does plus a short voice
profile (`bridge/voice-profile.md`) that asks for one or two spoken sentences.

In Home Assistant: add the **Ollama** integration, URL `http://127.0.0.1:11434`, Model `core`.

> The Model field selects nothing. It is a label the Ollama protocol demands — the bridge throws
> it away, and Core picks its own LLM from `data/pi/settings.json` as usual. Set **"Control Home
> Assistant" to off** in the conversation subentry: Core is the brain and already reaches the
> house through its own skill.

Session handling: HA sends its own message history, but the bridge reads only the newest user
message and lets pi's session hold the thread — so continuity and long-term memory come for free.
After 30 minutes of silence it starts a fresh session. One turn runs at a time; a question that
arrives mid-turn is told to wait rather than queued.

**The port is bound to `127.0.0.1` deliberately.** It is unauthenticated and it runs Core's
tools. Anyone who can reach it can drive the agent.

### Voice input

Your phone does not transcribe. The companion app runs only the **wake word** on-device
(microWakeWord, Android app 2026.2.3+, under Settings → Companion app → Assist for Android) and
streams the audio to Home Assistant — which needs its own speech-to-text engine. That is the
`whisper` service.

Add it in HA through the **Wyoming Protocol** integration (`127.0.0.1`, port `10300`), then build
an Assist pipeline: Whisper for speech-to-text, the Ollama agent for the conversation, and
**text-to-speech left unset** — Core answers as text in the Assist dialog, it does not speak.

No `--language` is pinned, so Whisper auto-detects and one container can serve both a German and
an English pipeline. Pick the assistant you want in the app.

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
   Already baked in: **`yt-dlp`** (youtube) and **`gh`** (github-pages). Both are tiny and
   harmless if unused, so they're installed regardless to keep setup simple.

Declare dependencies in `SKILL.md` frontmatter (OpenClaw-compatible):
```yaml
metadata:
  { "core": { "requires": { "bins": ["gh"], "env": ["GITHUB_TOKEN"] } } }
```
Credentials live in `data/secrets/` (git-ignored), read by the CLI — never through the model.
Prefer **read-only** scopes and least privilege.

### Google setup (one time) — Gmail, Drive, Calendar, Tasks, Sheets, Docs, YouTube

The Google skills (`gmail`, `drive`, `calendar`, `tasks`, `sheets`, `docs`, `youtube`) share one
OAuth token. In Google Cloud:

1. **Enable the APIs** you use: Gmail, Google Drive, Google Calendar, Google Tasks, Google
   Sheets, Google Docs, YouTube Data API v3. (A scope only appears in the consent screen's
   picker *after* its API is enabled.)
2. Create a **Web application** OAuth client, redirect URI `http://localhost:4100/oauth2callback`,
   and add the scopes (the authoritative list lives in `scripts/google-consent.mjs`):
   - `gmail.readonly`, `gmail.compose`, `gmail.modify` (triage: read/unread, label, archive),
     `gmail.send` (send a draft **you** reviewed — never unprompted)
   - `drive` (full: needed to *move* processed files out of the Drive inbox folder)
   - `calendar.events` (read + create/edit/delete events), `calendar.readonly` (list your
     calendars — `calendar.events` alone does not cover that)
   - `youtube.readonly`
   - `tasks` (Google Tasks read/write), `spreadsheets` (Sheets read/write), `documents` (Docs read/write)

   Add yourself as a test user.
3. Download the client JSON to `data/secrets/google_client_secret.json`.

Then run on the host:
```bash
node scripts/google-consent.mjs    # opens a consent URL; approve once
```
It writes `data/secrets/google_oauth.json` (one refresh token for all scopes) and **reports
which scopes were granted** — re-run it whenever you add a skill that needs a new scope.

---

## Adding or switching a model

Model setup is config-only — no code changes. The three values are in
[Setup](#1-point-core-at-your-model--three-values); switching later just means editing them and
restarting. After any change run `docker compose restart core`, then verify:

```bash
docker exec core_harness pi --list-models
docker exec core_harness pi -p "hi"
```

- **Model entry** — in `models.json`, each model `id` is what the API expects; add
  `reasoning: true` for thinking models and `input: ["text","image"]` for multimodal.
- **Tool calling** — needs a model whose chat template supports it (Gemma 3/4, Qwen3,
  Llama 3.1+, Mistral-Nemo, most hosted instruct models). Without it the model *narrates* tool
  calls as text instead of executing them.
- **pi built-in provider** (openai / anthropic / gemini / …) — skip the `api` entry entirely:
  set that provider's standard key in `.env` (e.g. `OPENAI_API_KEY`) and put `"<provider>/<id>"`
  in `settings.json` `defaultModel`. Confirm exact names with `pi --list-models`.
- **Self-hosting** — run your own OpenAI-compatible server (llama.cpp, vLLM, LM Studio, …),
  point the `api` provider's `baseUrl` at it, and set `defaultModel` to the id it reports.
  Same three values; only the endpoint is yours. Core does not ship a model server — keep it
  in its own repo so several projects can share one.
