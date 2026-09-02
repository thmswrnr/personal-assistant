#!/usr/bin/env bash
# Build our patched @agegr/pi-web into a tarball the Pi can install.
#
# Why a tarball rather than building on the Pi: the npm package ships no source
# (only a prebuilt .next), so any change needs a real Next build — and a Next
# build wants more RAM than a Pi 4 has spare. The built .next contains no native
# binaries, so it is architecture-portable. Runtime dependencies are still
# installed by npm ON the Pi, so anything native there resolves for arm64.
#
#   ./webui/build.sh
#   scp core/vendor/pi-web.tgz rpi@rpi:personal-assistant/core/vendor/
#   ssh rpi@rpi 'cd personal-assistant && docker compose build core && \
#     docker compose --profile home --profile webui up -d'
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."
ROOT="$PWD"
WORK="${WEBUI_BUILD_DIR:-$ROOT/webui/.build}"
OUT="$ROOT/core/vendor"

# shellcheck disable=SC2046
eval $(grep -E '^(repo|ref)=' webui/upstream.txt)
echo "upstream: $repo @ $ref" >&2

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"
git clone --depth 1 --branch "$ref" --quiet "$repo" "$WORK"

# Apply in filename order. Any failure stops the build — a silently skipped patch
# would ship a tarball missing one of our changes, which is worse than no build.
for patch in "$ROOT"/webui/patches/*.patch; do
  echo "applying $(basename "$patch")" >&2
  git -C "$WORK" apply --verbose "$patch"
done

cd "$WORK"
npm ci
npm test
npm run build
npm pack --pack-destination "$OUT"

# npm pack names the file from package.json; the Dockerfile wants one fixed name.
mv -f "$OUT"/agegr-pi-web-*.tgz "$OUT/pi-web.tgz"
echo "built $OUT/pi-web.tgz" >&2
