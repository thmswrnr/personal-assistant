---
description: 'Local fallback worker. Use ONLY to retry a task when an Alan-backed subagent failed (e.g. Alan unreachable). Runs on the local model. Spawn ONE at a time, never in parallel and never in the background (single GPU — it shares with the main session).'
model: local/local-model
prompt_mode: append
---
