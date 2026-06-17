---
name: alan
description: Ask Alan — the Comma-Soft Alan assistant (an agentic LLM at dev.alan.de). Use to send a question/prompt to Alan and get its answer, to continue or revisit an earlier Alan conversation (list existing chats and pick one up), or to list which Alan models are available. Reach for this when the user explicitly wants "Alan" / the Comma-Soft assistant or a second-opinion answer from it — not for general questions you can answer yourself.
metadata:
  { "core": { "requires": { "bins": ["node"], "files": ["/app/secrets/alan_api_key"] } } }
---

# Alan

Talks to the **Comma-Soft Alan** backend (`https://dev.alan.de/api/v1`) — an agentic assistant.
Auth is a personal API key sent as `Authorization: Bearer …`, read from `/app/secrets/alan_api_key`
(or `$ALAN_API_KEY`). Answers stream token-by-token to stdout.

```bash
A="node /app/.pi/skills/alan/scripts/alan.mjs"

# One-shot question → Alan's answer (default model: Gemma 4 Instant — fast)
$A ask "Summarise the EU AI Act in three bullet points"

# Pick a model: --instant (fast), --thinking (reasoning), --gpt (GPT-5.4), or --model <name>
$A ask "Plan a careful migration strategy" --thinking
$A ask "Draft a polite reminder email" --gpt

# Show the model's reasoning as it thinks (dimmed), then the answer
$A ask "What is 17*23?" --thinking --reasoning

# Steer with a system prompt
$A ask "translate to German" --system "You are a terse professional translator"

# List existing chats (newest first) / the chat models available
$A chats            # most recent 15 (--limit N, or --all)
$A models
```

## Continuing a conversation

Alan keeps each chat's prior turns server-side, so you can pick one up later. Two ways to get a
chat's id:

**Right after `ask`** — it answers in a fresh, UI-hidden chat and prints a footer to **stderr**:

```
— chat <chat_id> · msg <message_id>
```

**Or discover an earlier one** with `chats` — JSON of `{id, title, updated, model, apiOnly}`,
newest first (`apiOnly: true` = a chat this skill created; those have no `title`):

```bash
$A chats --limit 20
```

Then continue it — you only need the **chat id**; `reply` resolves the chat's latest message itself:

```bash
$A reply <chat_id> "And what about the second option?"
```

(You may also pass the `<prev_msg_id>` from a footer explicitly — `reply <chat_id> <prev_msg_id>
"…"` — which skips the lookup.) `reply` prints its own footer, so you can keep chaining.

## When to use what

- **`ask`** — the normal path. A single question; Alan replies. Summarise the answer for the user
  (it's already streamed in full). Default model is **Gemma 4 Instant** for a quick reply; use
  `--thinking` for hard reasoning, `--gpt` for the strongest general model.
- **`chats`** — to find an existing conversation to resume ("continue my last Alan chat", "what
  was that Alan thread about X"). Lists newest first; pick an `id`. Note skill-created chats show
  no title — identify them by `updated`/`model`, or `reply` to the most recent.
- **`reply`** — to continue a chat, whether one you just started (id from the footer) or one found
  via `chats`. Just pass the chat id; the latest message is resolved for you.
- **`models`** — when the user asks which Alan models exist, or before passing `--model`. Models
  marked `(inactive)` can't be used; pick an available one.

## Notes
- Don't reach for Alan for things you can already answer or another skill handles better — use it
  when the user specifically wants *Alan's* answer.
- The OpenAI-compatible `/oai/*` endpoints are intentionally not used (they're currently broken);
  this skill drives Alan's native streaming chat API.
- If the key is missing, the skill says so — add it to `/app/secrets/alan_api_key`. Create the key
  in Alan under user settings → API keys.
