# Optional local model server

Core is model-agnostic — by default it talks to a hosted OpenAI-compatible API. If you'd
rather **self-host the model**, this directory is a standalone [llama.cpp](https://github.com/ggml-org/llama.cpp)
server you can run on the same machine as Core, on another machine, or not at all.

It is completely separate from Core's main `docker-compose.yml`. Core only ever sees an HTTP
endpoint; this is one way to provide one (vLLM, LM Studio, Ollama's OpenAI endpoint, etc. work
just as well).

## Run it

```bash
# A GGUF must exist in the mounted models dir (defaults to ../../data/models).
docker compose up -d
curl -s http://localhost:8080/v1/models   # sanity check
```

NVIDIA GPU is assumed. For CPU-only, remove the `deploy.resources` block in
`docker-compose.yml` (expect it to be slow).

## Point Core at it

In the Core repo:

1. `data/pi/models.json` — set the `api` provider's `baseUrl`:
   - same machine, from Core's container: `http://host.docker.internal:8080/v1`
   - another machine: `http://<that-host-ip>:8080/v1`

   and set the model `id` to `local-model`.
2. `data/pi/settings.json` — `"defaultModel": "local-model"`.
3. `.env` — `LLM_API_KEY` can be anything; a local server ignores it.

Then `./core.sh -p "hello"` answers via your local model. Switching back to a hosted API is
just reverting those three values — no code changes.

## Notes

- The Gemma 4 projector (`mmproj-BF16.gguf`) gives this server vision **and** audio, so it can
  also back the Telegram bot's optional voice transcription — set `VOICE_LLM_URL` to
  `http://host.docker.internal:8080/v1/chat/completions` and `VOICE_MODEL=local-model`.
- Core no longer uses a separate small "utility" model — conversation compaction is handled
  natively by the main model. This stack therefore serves just the one model.
