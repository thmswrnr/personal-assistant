# Core — a local, private personal assistant

Core is a self-hosted assistant: a local, multimodal LLM (via
[llama.cpp](https://github.com/ggml-org/llama.cpp)) driven by the
[**pi**](https://github.com/earendil-works/pi) agent harness, in Docker, sharing a set of
folders on your machine. It reads and organizes your documents, keeps a "second brain,"
reaches services you connect (Gmail, Drive, Calendar, YouTube, the web), runs recurring
jobs on a schedule, and can reach you on Telegram — all running on your own box.

> **Status:** working end-to-end. The active model is **Gemma 4 12B** (text + vision) with a
> small **Llama 3.2 3B** "utility" model for context work. `docker compose up -d` starts the
> stack; you drive Core through the `./core.sh` launcher (and optionally a Telegram bot). It
> has real tool-calling + thinking, ~a dozen skills, a built-in scheduler, and automatic
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
              ┌────────────────────────┼──────────────┐                            │ Llama 3.2 3B (distill/  │
           data/pi   data/storage  data/secrets   skills/                          │ compaction)             │
           (config)   (your files)   (tokens)    (capabilities)                    └─────────────────────────┘
                                       │ http://searxng:8080  ┌──────────────────────┐
                                       └────────────────────▶ │ searxng (metasearch) │
                                                              └──────────────────────┘
```

- **`llm`** — llama.cpp CUDA server; loads the GGUF in `data/models/` + the vision projector,
  serves an OpenAI-compatible API. One slot, 49 K context (single-user).
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

### 1. Get the models
Three files go in `data/models/` (the helper script resumes interrupted downloads):

```bash
# main model (text + vision) + its vision projector
scripts/download-model.sh unsloth/gemma-4-12b-it-GGUF gemma-4-12b-it-Q4_K_M.gguf
scripts/download-model.sh unsloth/gemma-4-12b-it-GGUF mmproj-BF16.gguf
# small utility model (distillation + fast compaction)
scripts/download-model.sh bartowski/Llama-3.2-3B-Instruct-GGUF Llama-3.2-3B-Instruct-Q4_K_M.gguf
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
./core.sh                          # interactive chat (/exit or Ctrl-C to quit)
./core.sh "what's on my calendar?" # interactive, seeded with an opening message
./core.sh -p "summarize this: <url>"  # one-shot: print the answer and exit
./core.sh skill morning-briefing   # run a skill (force-loads the full skill — most reliable)
./core.sh skill process-inbox      # process files dropped in data/storage/inbox/
```
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
| `data/pi/` | `/app/.pi` | pi config: `models.json`, `SYSTEM.md`, `extensions/`, plus pi runtime (`sessions/`, `context.md`, …) |
| `data/storage/` | `/app/storage` | your files: `inbox/`, `notes/` (the second brain), `processed/`, `todos.md`, `schedule.json` |
| `data/secrets/` | `/app/secrets` | OAuth creds / tokens (git-ignored) |
| `data/models/` | `/models` (in `llm`) | the GGUF model files |
| `skills/` | `/app/.pi/skills` | `SKILL.md` capability packages (version-controlled) |
| `core/` | — | the core image (`Dockerfile`) + its runtime scripts (`scheduler/`, `bot/`) |
| `searxng/` | `/etc/searxng` (in `searxng`) | SearXNG config |

`data/` contents are git-ignored (only the authored config — `models.json`, `SYSTEM.md`,
`extensions/context-saver.mjs` — is tracked). Your data stays local.

---

## Skills

Skills are on-demand capability packages ([Agent Skills standard](https://agentskills.io/specification))
— a directory with a `SKILL.md` (frontmatter `name` + `description`, then instructions), in
`skills/` (mounted to pi's config dir). Current skills:

| Skill | What it does |
|---|---|
| `gmail` | Read email (search / read / labels) **and create drafts** — never sends. Gmail API. |
| `drive` | Read Google Drive (list / search / read; Docs→text, Sheets→CSV). Read-only. |
| `calendar` | Google Calendar (list / agenda / today / search). Read-only. |
| `youtube` | Video transcripts (summarize any video) + your subscriptions & new-videos feed. |
| `weather` | Current conditions + forecast via Open-Meteo (no API key). |
| `websearch` | Web search via the private SearXNG instance. |
| `web-read` | Fetch a URL and extract its main readable text (to summarize/answer from). |
| `notify` | Send *you* a Telegram message (hard-limited to your chat). |
| `schedule` | Manage recurring jobs (list / add / remove cron jobs). |
| `process-inbox` | Read each file in `inbox/` (incl. **images** via vision) → note + todos → archive. |
| `morning-briefing` | Dated greeting + unread email + today's calendar + weather + a joke. |
| `todos` | Maintain the single `todos.md` checklist. |

> **Invoke skills with `/skill:<name>`** (or `./core.sh skill <name>`) for reliable execution.
> pi uses *progressive disclosure*: only a skill's description is always in context; the full
> `SKILL.md` loads on demand. Asked in plain language, a local model may act on the description
> alone and skip steps — `/skill:<name>` forces the full instructions in.

Add a skill by creating `skills/<name>/SKILL.md` (+ an optional CLI) and `docker compose restart core`.

### Vision
Gemma 4 is multimodal — Core can *see* images. Drop an image in `data/storage/inbox/` and run
`process-inbox` (it reads receipts/screenshots/photos and files them), or point pi's `read`
tool at an image file. (Audio input is a model capability too, but not yet wired up.)

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

Texts to your bot then run through Core and reply; the `notify` skill (and scheduled tasks) can
message you. The bridge is **locked to your chat id** — it ignores everyone else. (Voice
messages aren't supported yet.)

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
   (`yt-dlp` is installed this way.)

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
