# Core — a local, private personal assistant

Core is a self-hosted assistant: a local, multimodal LLM (via
[llama.cpp](https://github.com/ggml-org/llama.cpp)) driven by the
[**pi**](https://github.com/earendil-works/pi) agent harness, in Docker, sharing a set of
folders on your machine. It reads and organizes your documents, keeps a "second brain,"
reaches services you connect (Gmail, Drive, Calendar, YouTube, the web), runs recurring
jobs on a schedule, and can reach you on Telegram — all running on your own box.

> **Status:** working end-to-end. The active model is **Gemma 4 12B** (text + vision) with a
> small **Qwen2.5 3B** "utility" model for context work. `docker compose up -d` starts the
> stack; you drive Core through the `./core.sh` launcher (and optionally a Telegram bot). It
> has real tool-calling + thinking, ~15 skills, a built-in scheduler, and automatic
> context management. CPU/GPU: built for a single ~16 GB NVIDIA GPU.

---

## Architecture

```
                         ┌───────────────────────────┐  http://llm:8080/v1   ┌─────────────────────────┐
                         │ core  (pi harness + sched) │ ───────────────────▶ │ llm  (llama.cpp, GPU)   │
   ./core.sh ──exec────▶ │ Node 22 · read/write/edit/ │                       │ Gemma 4 12B + vision    │
   (Telegram bot ─────▶) │ bash · skills · scheduler  │ ──┐                   └─────────────────────────┘
                         └─────────────┬──────────────┘   │ http://llm-util:8080  ┌─────────────────────────┐
                                       │ volumes           └─────────────────────▶ │ llm-util (llama.cpp,GPU)│
              ┌────────────────────────┼──────────────┐                            │ Qwen2.5 3B (distill/    │
           data/pi   data/storage  data/secrets   skills/                          │ compaction)             │
           (config)   (your files)   (tokens)    (capabilities)                    └─────────────────────────┘
                                       │ http://searxng:8080  ┌──────────────────────┐
                                       └────────────────────▶ │ searxng (metasearch) │
                                                              └──────────────────────┘
```

- **`llm`** — llama.cpp CUDA server; loads the GGUF in `data/models/` + the vision projector,
  serves an OpenAI-compatible API. 3 slots over a **unified KV pool** (49 K total context shared
  dynamically) so the interactive session, bot, and scheduler don't starve each other.
- **`llm-util`** — a small, fast model used only by the context-saver extension to distill big
  tool output and summarize on compaction (keeps the main model's context lean).
- **`searxng`** — self-hosted, private metasearch (the `websearch` skill); no API key.
- **`core`** — the pi harness. Runs the **scheduler** as its main process and executes skills.
  Interactive/one-shot use attaches via `docker exec` (the `./core.sh` launcher).
- **`bot`** — *optional* Telegram bridge (off unless you enable its profile).

---

## Prerequisites

- Docker + Docker Compose
- **NVIDIA GPU** (~16 GB VRAM for the default models) + drivers + the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
  CPU-only is possible (remove the `deploy.resources` blocks) but slow.
- The GGUF model files in `data/models/` (see Setup) — not committed (too large).

---

## Setup

**Quick path:** run `./setup.sh` — it checks prerequisites, creates `.env`, generates the
SearXNG secret, downloads the models, walks you through the optional integrations you want
(Telegram / Sonos / GitHub / Google), and builds & starts the stack. It's idempotent — re-run it
anytime to add an integration; it won't overwrite anything you've set. The manual steps below are
the same thing by hand.

### 1. Get the models
Three files go in `data/models/` (the helper script resumes interrupted downloads):

```bash
# main model (text + vision) + its vision projector
scripts/download-model.sh unsloth/gemma-4-12b-it-GGUF gemma-4-12b-it-Q5_K_M.gguf
scripts/download-model.sh unsloth/gemma-4-12b-it-GGUF mmproj-BF16.gguf
# small utility model (distillation + fast compaction)
scripts/download-model.sh bartowski/Qwen2.5-3B-Instruct-GGUF Qwen2.5-3B-Instruct-Q5_K_M.gguf
```

### 2. Environment
Copy `.env.example` → `.env`. For local use you only need a SearXNG secret (used by the
websearch container):
```bash
cp .env.example .env
# in .env:  SEARXNG_SECRET=$(openssl rand -hex 32)
```
Cloud API keys (Gemini/OpenAI/Anthropic) and `TELEGRAM_*` are optional — see below.

### 3. Start
```bash
docker compose up -d --build       # builds core, starts llm + llm-util + searxng + core
```
The first start downloads/loads the models (gated by a healthcheck, ~30–60 s).

Optional integrations: **Google** (Gmail/Drive/Calendar/YouTube) — see "Integrating external
services"; **Telegram** — see "Telegram bridge".

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
It starts the stack if needed, waits for the model, and loads the context-saver extension.

### Under the hood (equivalent raw commands)
```bash
curl -s http://localhost:8080/v1/models | jq                                  # is the model up?
docker exec -it core_harness pi --model local/local-model -e /app/.pi/extensions/context-saver.mjs
docker exec core_harness pi -p "/skill:process-inbox" --model local/local-model -e /app/.pi/extensions/context-saver.mjs
```

Stop: `docker compose down`.

---

## Folder layout

| Host path | In `core` | Purpose |
|---|---|---|
| `data/pi/` | `/app/.pi` | pi config: `models.json`, `SYSTEM.md`, `extensions/`, plus pi runtime (`sessions/`, …) |
| `data/storage/` | `/app/storage` | your files: `inbox/`, `notes/` (the second brain), `processed/`, `projects/` (per-project `plan.md` + `todos.md`), `schedule.json`, `memory/` (long-term facts), `custom_skills/` (Core's own writable skills — see `skill-builder`). The main to-do list lives in Google Tasks, not here. |
| `data/secrets/` | `/app/secrets` | OAuth creds / tokens (git-ignored) |
| `data/models/` | `/models` (in `llm`) | the GGUF model files |
| `skills/` | `/app/.pi/skills` | `SKILL.md` capability packages (version-controlled) |
| `core/` | — | the core image (`Dockerfile`) + its runtime scripts (`scheduler/`, `bot/`) |
| `searxng/` | `/etc/searxng` (in `searxng`) | SearXNG config |

`data/` contents are git-ignored (only the authored config — `models.json`, `SYSTEM.md`, and the
`extensions/` source — is tracked). Your data, including `storage/memory/`, stays local.

---

## Skills

Skills are on-demand capability packages ([Agent Skills standard](https://agentskills.io/specification))
— a directory with a `SKILL.md` (frontmatter `name` + `description`, then instructions), in
`skills/` (mounted to pi's config dir). Current skills:

| Skill | What it does |
|---|---|
| `gmail` | Read email (search / read / labels) **and create drafts** — never sends. Gmail API. |
| `drive` | Read Google Drive (list / search / read; Docs→text, Sheets→CSV). Read-only. |
| `calendar` | Google Calendar — list / agenda / today / search, **and create / edit / delete events** (confirms before writing). |
| `sheets` | Google Sheets — create a spreadsheet, read a range, append rows, overwrite cells. Confirms before writing. |
| `docs` | Google Docs — create a doc, read its text, append text. Confirms before writing. |
| `youtube` | Video transcripts (summarize any video) + your subscriptions & new-videos feed. |
| `weather` | Current conditions + forecast via Open-Meteo (no API key). |
| `transit` | German public-transport / Deutsche Bahn connections, departures, delays & platforms via the free transport.rest DB API (no key). |
| `websearch` | Web search via the private SearXNG instance. |
| `web-read` | Fetch a URL and extract its main readable text (to summarize/answer from). |
| `browser` | Drive a fresh headless browser — open/click/fill/navigate via accessibility-ref snapshots (Playwright CLI). For interaction; sandboxed, logged-out. |
| `notify` | Send *you* a Telegram message (hard-limited to your chat). |
| `schedule` | Manage recurring jobs (list / add / remove cron jobs). |
| `process-inbox` | Read each file in `inbox/` (incl. **images** via vision) → note + todos → archive. |
| `morning-briefing` | Dated greeting + unread email + today's calendar + weather + a joke. |
| `todos` | Manage your main to-do list, backed by **Google Tasks** (syncs to the Google Tasks app + Gmail/Calendar side panel) — add / list / complete, due dates, multiple lists. |
| `project-planning` | Break any task/problem into a structured plan; saves real projects to their own `storage/projects/<slug>/` folder (`plan.md` + a plain-markdown `todos.md`). |
| `haushaltsbuch` | Log expenses to your `haushaltsbuch<year>` Google Sheet — classifies receipt items by category, sums per category, appends one row per category to the "Variable Ausgaben" tab. Markdown-only skill on top of `sheets`. |
| `skill-builder` | Lets Core author or modify its **own** skills — only on explicit request, shown for approval before writing, into the writable `custom_skills/` area (curated skills stay read-only). |
| `remember` | Save / recall / forget durable facts (Core's long-term memory — see below). |
| `github-pages` | Publish a static site to GitHub Pages (create repo → push → enable Pages). Needs a PAT in `data/secrets/github_token`. |
| `sonos` | Control a Sonos speaker — play / pause / volume / favorites. Local network; set `SONOS_HOST` (the speaker IP) in `.env`. |

> **Invoke skills with `/skill:<name>`** (or `./core.sh skill <name>`) for reliable execution.
> pi uses *progressive disclosure*: only a skill's description is always in context; the full
> `SKILL.md` loads on demand. Asked in plain language, a local model may act on the description
> alone and skip steps — `/skill:<name>` forces the full instructions in.

Add a skill by creating `skills/<name>/SKILL.md` (+ an optional CLI) and `docker compose restart core`.

### Vision & voice
Gemma 4 is multimodal — Core can *see* images and *hear* audio. Drop an image in
`data/storage/inbox/` and run `process-inbox` (it reads receipts/screenshots/photos and files
them), or point pi's `read` tool at an image file. Over the Telegram bridge you can also send
photos (analysed via vision) and **voice notes** (transcribed by the model's own audio encoder —
no separate speech-to-text service).

---

## Memory (long-term)

Core runs are **stateless** — every command, scheduled job, and Telegram message is a fresh `pi`
process. Long-term memory is how durable facts survive that: they're recorded as small files
under `data/storage/memory/` (one fact per file), with an auto-generated `MEMORY.md` **index**.

- The `memory.mjs` extension (registered from `context-saver.mjs`, so it loads on every entry
  point) injects the index into the system prompt on **every** run — zero tool calls, always
  present. Full fact files are read on demand only when relevant — the same *progressive
  disclosure* as skills, so context stays lean.
- The `remember` skill captures facts: `save` / `forget` / `list`, with the index regenerated on
  every change (so it can't drift). Core saves a fact when you ask ("remember that…") or when a
  clearly durable preference/fact emerges — not one-off details.

The payoff: a scheduled `notify` or a one-off command runs with your preferences and key facts
already in context — no re-asking, no stale assumptions.

---

## Context management (automatic)

To keep the model's context lean over long sessions, a pi extension
(`data/pi/extensions/context-saver.mjs`, loaded by `core.sh`) transforms large tool output
before it reaches the model:

- **Spill-to-file** — big *list-like* JSON (search results, the subscriptions feed, …) is
  written to a file and replaced with a compact preview + path; the model queries it with `jq`.
  Deterministic, free.
- **Distill** — big *prose* (web pages, transcripts, long email bodies) is condensed by the
  small `llm-util` model to just what's relevant, keeping the full text on disk as a fallback.
- **Fast compaction** — when pi compacts the conversation, the summary is produced by the fast
  `llm-util` model instead of the 12 B.

Both `llm-util`-based features degrade gracefully if that service is down.

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

## Telegram bridge (optional)

Chat with Core from your phone, and let it `notify` you. **Optional** — Core and the scheduler
run fine without it.

1. Create a bot with **@BotFather**, put the token in `.env` as `TELEGRAM_BOT_TOKEN`.
2. Start the bridge:  `docker compose --profile telegram up -d bot`
3. Message your bot once, then `docker logs core_bot` — it prints your chat id. Put it in `.env`
   as `TELEGRAM_CHAT_ID` and run the start command again.

Texts, **voice notes** (transcribed locally), and **photos** (read via vision) all run through
Core and get a reply; the bot acks instantly, streams the answer in as it's written, and shows
which tool/skill is running. The `notify` skill (and scheduled tasks) can message you too. The
bridge is **locked to your chat id** — it ignores everyone else.

Your chat is **one ongoing conversation** — Core remembers the prior turns (so follow-ups like
"and what about tomorrow?" work), and it survives bot restarts. Send **`/new`** (or `/reset`)
to clear the context and start fresh.

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

1. **Pure API (HTTP + JSON)** → a small **self-contained Node CLI** in the skill folder (the
   image has `node`, `curl`, `jq` — **no rebuild**). The CLI holds the credential and calls the
   API, so the token never enters the model's context. Most skills are this case.
2. **A mature official CLI exists** (e.g. `gh`, `yt-dlp`, `ffmpeg`) → install it in
   **`core/Dockerfile`** (pinned) and rebuild once; the `SKILL.md` documents how to call it.
   Already baked in: **`yt-dlp`** (youtube), **`gh`** (github-pages), **`ffmpeg`** (voice),
   **`sonos`** (sonos — compiled from source in a
   multi-stage build, since upstream ships macOS binaries only), and **`@playwright/cli` +
   headless Chrome** (browser). Most are tiny and
   harmless if unused; **Chrome is the one heavy add (~hundreds of MB)** — the cost of the
   `browser` skill. They're all installed regardless to keep setup simple.

Declare dependencies in `SKILL.md` frontmatter (OpenClaw-compatible):
```yaml
metadata:
  { "openclaw": { "requires": { "bins": ["gh"], "env": ["GITHUB_TOKEN"] } } }
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

### A local GGUF (the default path)
```bash
scripts/download-model.sh <hf_repo> <filename>     # into data/models/
```
Then **register** it (downloading alone isn't enough):

1. **`docker-compose.yml`** (`llm`): `LLAMA_ARG_MODEL=/models/<filename>`
   (`LLAMA_ARG_ALIAS=local-model` keeps the served id stable). For a multimodal model add
   `LLAMA_ARG_MMPROJ=/models/<projector>.gguf`.
2. **`data/pi/models.json`**: update the entry — `id` matches `LLAMA_ARG_ALIAS`; `reasoning: true`
   for thinking models; `input: ["text","image"]` only for multimodal; `contextWindow` ≤
   `LLAMA_ARG_CTX_SIZE`.
3. Apply: `docker compose up -d llm && docker compose restart core`.

> **Tool calling needs `LLAMA_ARG_JINJA=1`** (already set) plus a model whose chat template
> supports tools (Gemma 3/4, Qwen3, Llama 3.1+, Mistral-Nemo, …). Models without it *narrate*
> tool calls as text instead of executing them.

### A commercial model (e.g. Gemini)
pi is natively multi-provider: add the API key to `.env`, add a provider/model entry, and
select it (e.g. `pi --provider google --model gemini-2.x-...`). No code change.

---

## Troubleshooting

- **Skill only half-runs / steps skipped** — invoke it as `/skill:<name>` so the full `SKILL.md`
  loads into context (see "Skills").
- **`EACCES` writing under `/app/.pi`** — leftover root-owned files from an earlier run:
  `docker exec -u 0 core_harness chown -R node:node /app/.pi`.
- **pi can't reach the model** — `models.json` `baseUrl` must be `http://llm:8080/v1` (the compose
  service name, not `localhost`); check `/v1/models` responds.
- **Model id mismatch** — the `id` in `models.json` must match what `/v1/models` reports (kept
  stable by `LLAMA_ARG_ALIAS=local-model`).
- **A scheduled job runs very slowly** — the local 12 B occasionally goes into a long generation;
  heavy multi-step prompts (e.g. a full briefing) take a few minutes. Keep scheduled prompts
  focused; a per-job timeout in the scheduler is an easy add if it recurs.
- **GPU not found / out of memory** — ensure the NVIDIA Container Toolkit is installed. Two
  models share the GPU; if VRAM is tight, lower `LLAMA_ARG_CTX_SIZE` on `llm-util` (or `llm`).
- **Agent narrates tool calls instead of running them** — the model lacks usable tool-calling or
  `LLAMA_ARG_JINJA=1` is off. Use a function-calling model with jinja on.
- **websearch errors** — the `searxng` container must be up and `SEARXNG_SECRET` set in `.env`.
