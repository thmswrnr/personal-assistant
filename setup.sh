#!/usr/bin/env bash
# Bootstrap a fresh clone of Core: prerequisites → .env → SearXNG secret → models →
# optional integrations → build & start. Safe to re-run (idempotent): it only fills in
# what's missing and never clobbers values you've already set.
#
# All skill *tools* are baked into the image regardless (they're small and harmless if
# unused). The only things you actually need to CONFIGURE are the integrations you want —
# this script walks you through those and leaves the rest unconfigured (their skills just
# report "not configured" if ever invoked).
set -euo pipefail
cd "$(dirname "$0")"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '   \033[33m! %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓ %s\033[0m\n' "$*"; }

# Ask a yes/no question (default in $2). Returns 0 for yes.
yesno() {
  local q="$1" d="${2:-n}" a prompt
  [ "$d" = y ] && prompt="Y/n" || prompt="y/N"
  read -rp "   $q [$prompt] " a || true
  a="${a:-$d}"
  [[ "$a" =~ ^[Yy] ]]
}

# Read a value (silent for secrets if $2=secret). Empty input → skip (prints nothing).
askval() {
  local q="$1" mode="${2:-}" v
  if [ "$mode" = secret ]; then read -rsp "   $q (leave blank to skip): " v || true; echo
  else read -rp "   $q (leave blank to skip): " v || true; fi
  printf '%s' "$v"
}

# Set or update KEY=VALUE in .env — newline-safe (never glues onto a previous line).
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    [ -s .env ] && [ -n "$(tail -c1 .env)" ] && printf '\n' >> .env  # ensure trailing newline
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

# ── 1. Prerequisites ────────────────────────────────────────────────────────────────
bold "1/6  Checking prerequisites"
command -v docker >/dev/null || { warn "docker not found — install Docker first."; exit 1; }
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else warn "Docker Compose not found — install it first."; exit 1; fi
ok "docker + compose present"
if docker info 2>/dev/null | grep -qi nvidia || command -v nvidia-smi >/dev/null 2>&1; then
  ok "NVIDIA GPU runtime detected (only needed if you self-host the model)"
else
  info "No NVIDIA GPU runtime — fine. Core talks to an external API; a GPU is only needed if you"
  info "choose to self-host the model (see examples/local-models/)."
fi

# ── 2. .env ─────────────────────────────────────────────────────────────────────────
bold "2/6  Environment file (.env)"
if [ -f .env ]; then ok ".env exists — keeping it (will only fill in blanks)"
else cp .env.example .env; ok "created .env from .env.example"; fi

# ── 3. SearXNG secret (a hard dependency — the stack won't start without it) ──────────
bold "3/6  SearXNG secret"
if grep -qE '^SEARXNG_SECRET=.+' .env; then ok "SEARXNG_SECRET already set"
else set_env SEARXNG_SECRET "$(openssl rand -hex 32)"; ok "generated SEARXNG_SECRET"; fi

# ── 4. Model API key (the hard dependency for talking to your LLM) ─────────────────────
bold "4/6  Model API key (LLM_API_KEY)"
info "Core talks to an OpenAI-compatible API. The endpoint + model live in data/pi/models.json"
info "(the 'api' provider) and data/pi/settings.json; only the KEY goes here."
info "Self-hosting instead? Any value works (a local server ignores it) — see step 5."
if grep -qE '^LLM_API_KEY=.+' .env; then ok "LLM_API_KEY already set"
else
  k="$(askval "Your model API key" secret)"
  if [ -n "$k" ]; then set_env LLM_API_KEY "$k"; ok "LLM_API_KEY saved"
  else warn "no key entered — set LLM_API_KEY in .env before Core can reach a hosted model."; fi
fi

# ── 5. Optional integrations (configure only what you want) ───────────────────────────
bold "5/6  Optional integrations — skip any you don't use (just press Enter)"
USE_TELEGRAM=no

if yesno "Telegram bridge (chat with Core from your phone + notify)?"; then
  t="$(askval "Bot token from @BotFather" secret)"
  [ -n "$t" ] && { set_env TELEGRAM_BOT_TOKEN "$t"; USE_TELEGRAM=yes; ok "token saved"; \
    info "After it starts: message your bot, run '$DC logs core_bot' to get your chat id,"; \
    info "set TELEGRAM_CHAT_ID in .env, then re-run this script (or restart the bot)."; } \
    || warn "no token entered — Telegram left off"
fi

if yesno "Sonos speaker control?"; then
  ip="$(askval "Speaker LAN IP (Sonos app → Settings → System → About → IP)")"
  [ -n "$ip" ] && { set_env SONOS_HOST "$ip"; ok "SONOS_HOST=$ip"; } || warn "no IP — Sonos left off"
fi

if yesno "GitHub Pages publishing?"; then
  gh="$(askval "GitHub PAT (classic, scope 'repo')" secret)"
  [ -n "$gh" ] && { printf '%s\n' "$gh" > data/secrets/github_token; ok "saved to data/secrets/github_token"; } \
    || warn "no token — github-pages left off"
fi

if yesno "Google suite (Gmail / Drive / Calendar / YouTube)?"; then
  info "Google needs a one-time browser consent that this script can't automate:"
  info "  1. Put your OAuth client JSON at data/secrets/google_client_secret.json"
  info "  2. Run on the host:  node scripts/google-oauth.mjs   (see README → Google setup)"
fi

# Comma-Soft Alan *skill* — ask the Alan assistant from inside Core. Reads its key from
# data/secrets/alan_api_key. This is separate from your model provider (LLM_API_KEY) above —
# though if Alan IS your model provider, use that same key for LLM_API_KEY.
if yesno "Comma-Soft Alan skill (ask the Alan assistant)?"; then
  a="$(askval "Alan API key (Bearer — Alan → user settings → API keys)" secret)"
  if [ -n "$a" ]; then
    printf '%s\n' "$a" > data/secrets/alan_api_key
    ok "Alan key saved (data/secrets/alan_api_key)"
  else warn "no key — Alan skill left off"; fi
fi

# Self-hosting the model (optional) — download the GGUF for examples/local-models/.
if yesno "Self-host the model locally (downloads ~8GB GGUF for examples/local-models/)?"; then
  for m in "unsloth/gemma-4-12b-it-GGUF gemma-4-12b-it-Q5_K_M.gguf" \
           "unsloth/gemma-4-12b-it-GGUF mmproj-BF16.gguf"; do
    f="data/models/$(echo "$m" | awk '{print $2}')"
    [ -f "$f" ] && ok "have $(basename "$f")" || scripts/download-model.sh $m
  done
  info "Start it:  cd examples/local-models && docker compose up -d"
  info "Then point the 'api' provider baseUrl in data/pi/models.json at it (see its README)."
fi

# ── 6. Build & start ──────────────────────────────────────────────────────────────────
bold "6/6  Build & start"

# Self-written skills: ensure the writable skills area exists and is loaded by pi.
# (settings.json + data/storage are gitignored runtime state, so wire them here.)
mkdir -p data/storage/custom_skills
SETTINGS=data/pi/settings.json
if command -v node >/dev/null 2>&1; then
  node -e 'const fs=require("fs"),f=process.argv[1];let j={};try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
j.skills=Array.from(new Set([...(j.skills||[]),"/app/storage/custom_skills"]));
fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")' "$SETTINGS" && ok "custom_skills wired into pi settings"
elif [ ! -f "$SETTINGS" ]; then
  printf '{\n  "skills": ["/app/storage/custom_skills"]\n}\n' > "$SETTINGS"; ok "custom_skills wired (new settings.json)"
else
  grep -q custom_skills "$SETTINGS" || warn "Add \"/app/storage/custom_skills\" to the \"skills\" array in $SETTINGS to enable self-written skills."
fi

# Subagent delegation extension (pinned). Lets Core act as a boss agent that fans independent
# work out to parallel subagents. It's a pi package, so it installs into the bind-mounted
# data/pi (settings.json + npm/ — both gitignored runtime state) and pi auto-discovers it on
# every run; that means it must be (re)installed per clone, here. Idempotent.
SUBAGENTS_PKG="npm:@tintinweb/pi-subagents@0.10.3"

PROFILE=(); [ "$USE_TELEGRAM" = yes ] && PROFILE=(--profile telegram)
if yesno "Build the image and start the stack now?" y; then
  $DC "${PROFILE[@]}" up -d --build
  ok "stack starting (core + searxng)"
  if docker exec core_harness pi install "$SUBAGENTS_PKG" >/dev/null 2>&1; then
    ok "subagent extension installed ($SUBAGENTS_PKG)"
  else
    warn "couldn't install the subagent extension now — run it later:"
    info "  docker exec core_harness pi install $SUBAGENTS_PKG"
  fi
else
  info "When ready:  $DC ${PROFILE[*]} up -d --build"
  info "Then enable subagents:  docker exec core_harness pi install $SUBAGENTS_PKG"
fi

bold "Done."
info "Talk to Core:        ./core.sh         (or ./core.sh --continue to resume)"
info "Run a skill:         ./core.sh skill morning-briefing"
[ "$USE_TELEGRAM" = yes ] && info "Telegram bridge:     started (set TELEGRAM_CHAT_ID then restart if you haven't)"
info "Re-run this script anytime to add an integration — it won't overwrite what's set."
