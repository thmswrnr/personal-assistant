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
# It makes sure the stack is running first. Thanks to the health gate, startup returns
# only once the model is actually loaded and serving (first run can take ~30s).
set -euo pipefail
cd "$(dirname "$0")"

MODEL="local/local-model"
CONTAINER="core_harness"
# Context-saver extension: spills large JSON tool output to a file (the model queries it
# with jq) to keep context lean. Auto-discovery doesn't load .mjs, so pass it explicitly.
EXT="/app/.pi/extensions/context-saver.mjs"
# Interactive sessions live in their own dir so `--continue` resumes the last *CLI* chat and
# never picks up a Telegram session (the bot shares the project but uses the default dir).
CLI_SESSIONS="/app/.pi/sessions-cli"

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
  -c|--continue)
    # Resume the last interactive session (optionally with an opening message).
    shift
    if [ $# -gt 0 ]; then
      exec docker exec "${TTY[@]}" "$CONTAINER" pi -e "$EXT" --session-dir "$CLI_SESSIONS" --continue "$*" --model "$MODEL"
    else
      exec docker exec "${TTY[@]}" "$CONTAINER" pi -e "$EXT" --session-dir "$CLI_SESSIONS" --continue --model "$MODEL"
    fi
    ;;
  "")
    # New interactive session.
    exec docker exec "${TTY[@]}" "$CONTAINER" pi -e "$EXT" --session-dir "$CLI_SESSIONS" --model "$MODEL"
    ;;
  *)
    # New interactive session, seeded with an opening prompt.
    exec docker exec "${TTY[@]}" "$CONTAINER" pi -e "$EXT" --session-dir "$CLI_SESSIONS" --model "$MODEL" "$*"
    ;;
esac
