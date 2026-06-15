#!/usr/bin/env bash
# Easy interface to talk to Core (the local assistant).
#
# Usage:
#   ./core.sh                          Interactive chat (type messages; /exit or Ctrl-C to quit).
#                                      In-session: /new resets, /resume picks a past session.
#                                      One-shot modes below are stateless (--no-session).
#   ./core.sh "summarize my notes"     Interactive, seeded with an opening message
#   ./core.sh -p "what is 2+2?"        One-shot: print the answer and exit
#   ./core.sh skill morning-briefing   Run a skill by name (reliable — loads the full skill)
#   ./core.sh skill process-inbox
#
# It makes sure the stack is running first. Thanks to the health gate, startup returns
# only once the model is actually loaded and serving (first run can take ~30s).
set -euo pipefail
cd "$(dirname "$0")"

MODEL="local/local-model"
CONTAINER="core_harness"
# Context-saver extension: spills large JSON tool output to a file (the model queries it
# with jq) to keep context lean. Auto-discovery doesn't load .mjs, so pass it explicitly.
EXT="/app/.pi/extensions/context-saver.mjs"

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
    exec docker exec "${TTY[@]}" "$CONTAINER" pi -e "$EXT" --no-session -p "/skill:${name}${*:+ $*}" --model "$MODEL"
    ;;
  -p|--print)
    shift
    exec docker exec "${TTY[@]}" "$CONTAINER" pi -e "$EXT" --no-session -p "$*" --model "$MODEL"
    ;;
  "")
    exec docker exec "${TTY[@]}" "$CONTAINER" pi -e "$EXT" --model "$MODEL"
    ;;
  *)
    # Treat the argument as an opening prompt for an interactive session.
    exec docker exec "${TTY[@]}" "$CONTAINER" pi -e "$EXT" --model "$MODEL" "$*"
    ;;
esac
