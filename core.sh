#!/usr/bin/env bash
# Easy interface to talk to Core (the local assistant).
#
# Usage:
#   ./core.sh                          New interactive chat (type messages; /exit or Ctrl-C to quit).
#   ./core.sh --continue               Resume your last interactive session (-c); otherwise new.
#   ./core.sh "summarize my notes"     New interactive chat, seeded with an opening message.
#   ./core.sh -p "what is 2+2?"        One-shot: print the answer and exit (stateless).
#   ./core.sh skill morning-briefing   Run a skill by name (one-shot, stateless).
#   ./core.sh skill process-inbox
# In an interactive chat, /new starts a fresh session.
#
# It makes sure the stack is running first. The model is an external API (configured in
# data/pi/settings.json + data/pi/models.json), so there's no local model to wait for.
set -euo pipefail
cd "$(dirname "$0")"

# Core uses pi's own default model (data/pi/settings.json: defaultProvider/defaultModel), so we
# pass no --model here — changing the default there is all it takes to switch models.
#
# MODELS (optional): comma-separated patterns offered for in-session Ctrl+P cycling — BARE
# model ids/globs (e.g. "comma-soft/*"). Leave empty to skip. Switching mid-session also moves
# inherit-type subagents.
MODELS=""
MODELS_ARG=()
[ -n "$MODELS" ] && MODELS_ARG=(--models "$MODELS")
CONTAINER="core_harness"
# Core's context extensions — one dedicated concern each (spill large JSON to file, loop guard,
# long-term memory injection). Auto-discovery is trust-gated and skips .mjs, so load each
# explicitly with its own -e (the arg parser accepts repeated -e). Compaction is left to pi's
# native mechanism (it tracks file-ops in the summary, which a custom hook would discard).
EXT_DIR="/app/.pi/extensions"
EXT_ARGS=(-e "$EXT_DIR/spill.mjs" -e "$EXT_DIR/loop-guard.mjs" -e "$EXT_DIR/tool-call-guard.mjs" -e "$EXT_DIR/memory.mjs")

# Allocate a TTY only when we actually have one (so piped/non-interactive use still works).
if [ -t 0 ] && [ -t 1 ]; then TTY=(-it); else TTY=(-i); fi

echo "Ensuring Core is running (first start loads the model, ~30s)…" >&2
# Bring up the stack. If a Telegram token is configured, also start the optional bot
# bridge (the `telegram` profile) so it doesn't get silently left down; without a token
# the bridge is skipped entirely.
PROFILES=()
if [ -f .env ] && grep -qE '^TELEGRAM_BOT_TOKEN=.+' .env; then PROFILES=(--profile telegram); fi
docker compose "${PROFILES[@]}" up -d >/dev/null

case "${1:-}" in
  skill)
    shift
    [ $# -ge 1 ] || { echo "usage: ./core.sh skill <name> [args]" >&2; exit 1; }
    name="$1"; shift
    exec docker exec "${TTY[@]}" "$CONTAINER" pi "${EXT_ARGS[@]}" --no-session -p "/skill:${name}${*:+ $*}"
    ;;
  -p|--print)
    shift
    exec docker exec "${TTY[@]}" "$CONTAINER" pi "${EXT_ARGS[@]}" --no-session -p "$*"
    ;;
  -c|--continue)
    # Resume the last session (optionally with an opening message) — pi's native --continue.
    shift
    if [ $# -gt 0 ]; then
      exec docker exec "${TTY[@]}" "$CONTAINER" pi "${EXT_ARGS[@]}" --continue "$*" "${MODELS_ARG[@]}"
    else
      exec docker exec "${TTY[@]}" "$CONTAINER" pi "${EXT_ARGS[@]}" --continue "${MODELS_ARG[@]}"
    fi
    ;;
  "")
    # New interactive session.
    exec docker exec "${TTY[@]}" "$CONTAINER" pi "${EXT_ARGS[@]}" "${MODELS_ARG[@]}"
    ;;
  *)
    # New interactive session, seeded with an opening prompt.
    exec docker exec "${TTY[@]}" "$CONTAINER" pi "${EXT_ARGS[@]}" "${MODELS_ARG[@]}" "$*"
    ;;
esac
