#!/usr/bin/env bash
# Download a GGUF model from Hugging Face into data/models/.
#
# Usage:
#   scripts/download-model.sh <hf_repo> <filename>
#
# Example:
#   scripts/download-model.sh Qwen/Qwen3-14B-GGUF Qwen3-14B-Q4_K_M.gguf
#
# After downloading you still need to REGISTER the model (see README → "Adding or
# switching a model"): point LLAMA_ARG_MODEL at the file in docker-compose.yml and
# add/update the matching entry in data/memory/.pi/models.json.
set -euo pipefail

REPO="${1:-}"
FILE="${2:-}"
DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/models"

if [[ -z "$REPO" || -z "$FILE" ]]; then
  echo "Usage: $0 <hf_repo> <filename>" >&2
  echo "Example: $0 Qwen/Qwen3-14B-GGUF Qwen3-14B-Q4_K_M.gguf" >&2
  exit 1
fi

URL="https://huggingface.co/${REPO}/resolve/main/${FILE}"
mkdir -p "$DEST_DIR"

echo "Downloading ${REPO}/${FILE}"
echo "  -> ${DEST_DIR}/${FILE}"
# -L follow redirects, --fail error on 4xx/5xx, -C - resume partial downloads
curl -L --fail -C - -o "${DEST_DIR}/${FILE}" "$URL"

echo
echo "Done. Next steps to register it:"
echo "  1. docker-compose.yml  -> LLAMA_ARG_MODEL=/models/${FILE}"
echo "  2. data/memory/.pi/models.json -> add/update a model entry (id must match"
echo "     LLAMA_ARG_ALIAS; set reasoning:true for thinking models)"
echo "  3. docker compose up -d llm && docker compose restart core"
