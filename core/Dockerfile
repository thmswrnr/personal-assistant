# ---- build sonoscli (Go) — upstream publishes macOS binaries only, so we compile for Linux ----
# Pinned. Go's toolchain auto-management fetches the exact Go version go.mod asks for.
FROM golang:1.24-bookworm AS sonosbuild
ARG SONOSCLI_VERSION=v0.3.2
RUN GOBIN=/out go install github.com/steipete/sonoscli/cmd/sonos@${SONOSCLI_VERSION}

# ---- main image: Node 22 for the pi harness (pinned for reproducible builds) ----
FROM node:22.22.3-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    jq \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install the Pi Coding Agent, pinned to a tested version.
RUN npm install -g @earendil-works/pi-coding-agent@0.79.10

# yt-dlp (pinned) for the youtube skill — self-contained Linux binary, no Python/ffmpeg.
# The skill downloads only caption tracks and cleans them to text in Node.
ARG YT_DLP_VERSION=2026.06.09
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux" \
      -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# GitHub CLI (pinned) for the github-pages skill — official Linux binary, like yt-dlp.
ARG GH_VERSION=2.94.0
RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
      | tar -xz -C /tmp \
    && mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
    && rm -rf "/tmp/gh_${GH_VERSION}_linux_amd64" \
    && gh --version

# sonoscli (built above) for the sonos skill — controls the soundbar over the LAN (UPnP, port 1400).
COPY --from=sonosbuild /out/sonos /usr/local/bin/sonos

# Browser automation for the `browser` skill: Playwright CLI (a thin bash front-end —
# open/snapshot/click-by-ref/…) + headless Chrome. Chrome + its OS libs are the heavy part
# (~hundreds of MB — by far the largest addition). Browsers live in a fixed, world-readable
# path so the non-root `node` user can launch them at runtime.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g @playwright/cli@0.1.14 \
    && npx -y playwright@1.61.0 install --with-deps chrome \
    && chmod -R a+rx /ms-playwright \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# The Playwright CLI writes session/snapshot scratch (.playwright-cli/) to the working dir, so
# /app must be writable by the non-root runtime user.
RUN chown node:node /app

# The Pi harness operates in the /app directory
# Volumes are mapped in docker-compose.yml
CMD ["tail", "-f", "/dev/null"]
