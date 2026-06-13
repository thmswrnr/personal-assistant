# Core — a local, private personal assistant

Core is a self-hosted assistant: a local LLM (via [llama.cpp](https://github.com/ggml-org/llama.cpp))
driven by the [**pi**](https://github.com/earendil-works/pi) agent harness, both in Docker,
sharing a set of folders on your machine. It organizes documents, maintains a "second brain,"
and runs folder-driven jobs like *process my inbox* — all without your data leaving the box.

> **Status:** working end-to-end. `docker compose up` starts the local LLM (Qwen3-14B) and the
> pi harness; the agent reads/writes the shared folders and runs skills (`process-inbox`,
> `morning-briefing`) with real tool calls + thinking. Interactive use is via `docker exec`;
> a scheduled/file-watch driver and external-service (Tier 2) integrations are still pending.

---

## Architecture

```
┌─────────────────────────────┐     OpenAI-compatible HTTP      ┌────────────────────────┐
│ core_harness (pi + acpx)    │  ───────────────────────────▶  │ local_llm (llama.cpp)  │
│ Node 22                     │     http://llm:8080/v1          │ server-cuda, GPU       │
│ tools: read/write/edit/bash │                                 │ Qwen3-14B (GGUF), GPU  │
└──────────────┬──────────────┘                                 └────────────────────────┘
               │ mounted volumes
   ┌───────────┼───────────────────────────────┐
   data/memory/.pi   data/storage   data/secrets   skills/
   (config+memory)   (your files)   (tokens)       (SKILL.md capabilities)
```

- **`llm`** — llama.cpp CUDA server, loads the GGUF in `data/models/`, serves an OpenAI-compatible
  API on `:8080`.
- **`core`** — the pi harness. Talks to `llm`, reads/writes the shared folders, runs skills.

---

## Prerequisites

- Docker + Docker Compose
- **NVIDIA GPU** + drivers + the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
  (the `llm` service requests a GPU). To run CPU-only, remove the `deploy.resources` block from
  `docker-compose.yml` (expect it to be slow).
- A GGUF model in `data/models/` (see Setup). **Tool-calling + thinking matter** — the agent
  loop depends on real function-calling; the default is Qwen3-14B, which does both. Avoid older
  models (e.g. original Llama 3) that lack tool-calling.

---

## Setup

The repo is configured and ready; the only thing not in git is the model file (too large).

### 1. Get the model
The GGUF isn't committed. Download Qwen3-14B into `data/models/`:
```bash
scripts/download-model.sh Qwen/Qwen3-14B-GGUF Qwen3-14B-Q4_K_M.gguf
```
(See "Adding or switching a model" to use a different one.)

### 2. Environment
Optionally put cloud API keys (e.g. for switching to Gemini) in `.env`. Not needed for local use.

### How it's already wired (for reference)
- **`docker-compose.yml`** — `llm` serves the GGUF with `LLAMA_ARG_ALIAS=local-model` and
  `LLAMA_ARG_JINJA=1` (tool calling); `core` runs as the `node` user with
  `PI_CODING_AGENT_DIR=/app/.pi`.
- **`data/memory/.pi/models.json`** — registers the local server as pi provider `local`
  (model id `local-model`, `reasoning: true`), pointing at `http://llm:8080/v1`.
- **`data/memory/.pi/SYSTEM.md`** — Core's persona/system prompt (kept general; specific
  procedures live in skills). `context.md` is rolling memory the agent reads/updates.
- **`skills/`** — mounted to `/app/.pi/skills`; see "Skills".

---

## Running

Start the stack:
```bash
docker compose up -d --build
```

Verify the LLM is up (and see the served model id, `local-model`):
```bash
curl -s http://localhost:8080/v1/models | jq
```

`core` stays running (`tail -f /dev/null`) so you exec into it. Talk to the agent:
```bash
# interactive
docker exec -it core_harness pi --model local/local-model

# one-shot / scriptable
docker exec core_harness pi -p "What files are in storage/notes?" --model local/local-model

# run a skill (most reliable — see "Skills" below)
docker exec core_harness pi -p "/skill:process-inbox" --model local/local-model
docker exec core_harness pi -p "/skill:morning-briefing" --model local/local-model

# machine-readable event stream (includes thinking_* events)
docker exec core_harness pi -p "/skill:morning-briefing" --mode json --model local/local-model
```

Stop:
```bash
docker compose down
```

---

## Folder layout

| Host path | In `core` | Purpose |
|---|---|---|
| `data/memory/.pi/` | `/app/.pi` | pi config (`models.json`, `SYSTEM.md`), skills, rolling memory (`context.md`) |
| `data/storage/` | `/app/storage` | your files; the inbox/notes/todos live here |
| `data/secrets/` | `/app/secrets` | API tokens / OAuth creds (git-ignored) |
| `skills/` | `/app/.pi/skills` | `SKILL.md` capability packages (version-controlled) |
| `data/models/` | `/models` (in `llm`) | the GGUF model |

Suggested `data/storage/` contents (created as the inbox workflow lands):
```
storage/
  inbox/       # drop files/images here
  processed/   # archived after handling
  todos.md     # agent-maintained task list
  notes/       # the second brain
```

`data/memory/`, `data/storage/`, and `data/secrets/` contents are git-ignored (only `.gitkeep`
is tracked) — your data stays local.

---

## Skills

Skills are on-demand capability packages ([Agent Skills standard](https://agentskills.io/specification))
— a directory with a `SKILL.md` (frontmatter `name` + `description`, then instructions). They
live in `skills/` (mounted to pi's config dir at `/app/.pi/skills`) and are version-controlled.

Current skills:
- **`process-inbox`** — reads each file in `storage/inbox/`, writes a summary into
  `storage/notes/`, appends action items to `storage/todos.md`, and archives the original to
  `storage/processed/`.
- **`morning-briefing`** — a friendly dated greeting + a joke. Placeholder until email/calendar/
  todo integrations exist (Tier 2).

> **Invoke skills with `/skill:<name>` for reliable execution**, e.g.:
> ```bash
> docker exec core_harness pi -p "/skill:process-inbox" --model local/local-model
> ```
> pi uses *progressive disclosure*: only a skill's one-line description is always in context,
> and the full `SKILL.md` is loaded on demand. A local model asked in plain language
> ("process my inbox") tends to act on the description alone and skip steps. `/skill:<name>`
> forces the full instructions into context so the whole workflow runs. (Larger/cloud models
> follow plain-language triggers more reliably.)

Add your own skill by creating `skills/<name>/SKILL.md` and `docker compose restart core`.

## Adding or switching a model

### A local GGUF (the default path)

Use the helper script to fetch a GGUF from Hugging Face into `data/models/`:

```bash
scripts/download-model.sh <hf_repo> <filename>
# e.g.
scripts/download-model.sh Qwen/Qwen3-14B-GGUF Qwen3-14B-Q4_K_M.gguf
```

Then **register** it (downloading alone isn't enough — pi and the server each need to know):

1. **`docker-compose.yml`** (service `llm`): point at the file
   `LLAMA_ARG_MODEL=/models/<filename>`. (`LLAMA_ARG_ALIAS=local-model` keeps the served
   id stable so you rarely touch `models.json`.)
2. **`data/memory/.pi/models.json`**: update the model entry — `id` must match
   `LLAMA_ARG_ALIAS`; set `reasoning: true` for thinking models; set `input: ["text","image"]`
   only for multimodal models; `contextWindow` should not exceed `LLAMA_ARG_CTX_SIZE`.
3. Apply:
   ```bash
   docker compose up -d llm        # recreates the server on the new model
   docker compose restart core     # pi re-reads models.json
   ```

> **Tool calling needs `LLAMA_ARG_JINJA=1`** (already set). It makes llama.cpp use the model's
> chat template to format/parse tool calls. Pick a model whose template supports tools — Qwen3,
> Llama 3.1+, Mistral-Nemo, etc. Models without it (e.g. original Llama 3) will *narrate* tool
> calls as text instead of executing them.

### A commercial model (e.g. Gemini)

pi is natively multi-provider, so no GGUF needed: add the API key (in `.env` or a provider
block) and select it, e.g. `pi --provider google --model gemini-2.x-...`. No code change.

---

## Troubleshooting

- **`core` idles by design** — its command is `tail -f /dev/null`; you `docker exec` in to use
  it. (A scheduled/auto driver is a future step.)
- **Skill only half-runs / steps skipped** — invoke it as `/skill:<name>` rather than describing
  it in prose, so the full `SKILL.md` loads into context (see "Skills").
- **`EACCES` writing under `/app/.pi`** — leftover root-owned files from an earlier run. Fix:
  `docker exec -u 0 core_harness chown -R node:node /app/.pi/sessions /app/.pi/auth.json`.
- **pi can't reach the model** — check `models.json` `baseUrl` is `http://llm:8080/v1` (the compose
  service name, not `localhost`), and that `/v1/models` responds.
- **Model id mismatch** — the `id` in `models.json` must match what `/v1/models` reports
  (kept stable by `LLAMA_ARG_ALIAS=local-model`).
- **GPU not found** — ensure the NVIDIA Container Toolkit is installed, or drop the
  `deploy.resources` GPU block to run on CPU.
- **Agent narrates tool calls instead of running them** — the model lacks usable tool-calling
  (or `LLAMA_ARG_JINJA=1` is off). Use a function-calling model (Qwen3, Llama 3.1+) with jinja on.
