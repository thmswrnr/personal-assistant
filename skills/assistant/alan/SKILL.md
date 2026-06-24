---
name: alan
description: Ask Alan — the Comma-Soft Alan assistant (a remote agentic LLM at dev.alan.de, incl. frontier models like GPT-5.4). Use to send a one-off prompt and get Alan's answer, to continue or revisit an earlier Alan conversation (list or search existing chats, then pick one up), or to list available Alan models. Reach for it when the user explicitly wants "Alan" / the Comma-Soft assistant, or a stronger second opinion than Core's own model gives — not for general questions Core can answer itself. Does not use Alan's knowledge bases, experts, or file uploads.
metadata:
  { "core": { "requires": { "bins": ["node"], "files": ["/app/secrets/alan_api_key"] } } }
---

# Alan

Client for the **Comma-Soft Alan** backend (`https://dev.alan.de/api/v1`) — a remote assistant
with stronger/agentic models than Core runs locally. Auth is a personal API key
(`Authorization: Bearer …`, from `/app/secrets/alan_api_key` or `$ALAN_API_KEY`). Most commands
print **JSON** — pipe through `jq` to pull what you need. This skill is deliberately scoped to
plain chat: no knowledge bases, experts, abilities, or file attachments.

```bash
A="node /app/.pi/skills/assistant/alan/scripts/alan.mjs"

# One-off question → Alan's answer (streamed). Default model: Gemma 4 Instant (fast).
$A ask "Summarise the EU AI Act in three bullet points"
$A ask "Plan a careful migration strategy" --model comma-soft/gemma4-31b   # a thinking model
$A ask "What is 17*23?" --model comma-soft/gemma4-31b --reasoning          # show its reasoning

# Continue a conversation (just the chat id — the latest message is resolved for you)
$A reply <chat_id> "And what about the second option?"

# Find a chat to continue
$A chats                       # recent chats, newest first (--limit N, or --all)
$A search "migration plan"     # find chats by title/message content (--bookmarked to narrow)

# Discover models
$A models --available          # only chat-usable models (full attributes)
```

## Choosing a model

`models --available` returns the models you can pass to `--model` (status `available`, type
`chatllm`). The id to pass is the **`primary_name`** field:

```bash
$A models --available | jq -r '.models[] | "\(.primary_name)\t\(.title)\t\(.capabilities)"'
```

Each model's `description` says what it's for (e.g. Gemma *Thinking* = deep analysis, *Instant* =
quick answers; `openai/gpt-5.4` = strongest general model). If `--model` is omitted, `ask` uses a
fast default. `ask` is one-off; to keep context across turns, use `reply` (below).

## Continuing & finding a conversation

Alan stores each chat server-side, so a conversation can be resumed later. Get a chat id one of
three ways, then `reply <chat_id> "<prompt>"`:

- **Right after `ask`** — it prints `— chat <chat_id>` to stderr.
- **`chats`** — JSON `[{id, title, updated, model, apiOnly}]`, newest first. Best for "my last
  Alan chat". Note: chats this skill creates are `apiOnly` and have **no title** — identify them
  by `updated`/`model`, or find them by content with `search`.
- **`search "<query>"`** — JSON `{results:[{chat_id, excerpt}]}`, matching chat titles **and
  message text**. Best for "the Alan thread about X"; the `excerpt` confirms the match.

`reply` always continues from the chat's latest message (it resolves the tip itself — you never
pass a message id). It prints its own `— chat <chat_id>` footer, so you can keep chaining.

## When to use what

- **`ask`** — the normal path: one question, Alan answers. Summarise the streamed answer for the
  user. Use a thinking model (`--model comma-soft/gemma4-31b`) for hard reasoning, `openai/gpt-5.4`
  for the strongest general answer.
- **`reply`** — to continue a chat (from the `ask` footer, `chats`, or `search`).
- **`chats` / `search`** — to find an earlier conversation to resume (recency vs. by-topic).
- **`models`** — when the user asks which Alan models exist, or before choosing `--model`.

## Notes
- Use Alan when the user specifically wants *Alan's* answer or a stronger model than Core's own —
  not for things Core (or another skill) already handles.
- Chats are created `api_only` (hidden from the Alan web UI). Big payloads (full message lists)
  are consumed inside the script and never enter Core's context; only answers and chat ids print.
- The OpenAI-compatible `/oai/*` endpoints are intentionally unused (currently broken); this skill
  drives Alan's native streaming chat API.
- If the key is missing the skill says so — add it to `/app/secrets/alan_api_key` (create it in
  Alan under user settings → API keys).
