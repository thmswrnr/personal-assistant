# Core dashboard: Node + pi SDK. Same pinned base as the harness.
FROM node:22.22.3-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# yt-dlp (pinned) for the youtube skill — self-contained Linux binary, no Python/ffmpeg.
# The dashboard agent runs skills too, so it needs the same tooling as core.
ARG YT_DLP_VERSION=2026.06.09
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux" \
      -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app/ui

# Install deps (pi SDK) into the image — pinned + cached. The app code (server.mjs,
# public/) is mounted from the repo at runtime, so it preserves this node_modules.
COPY package.json ./
RUN npm install --omit=dev --no-fund --no-audit

EXPOSE 3000
CMD ["node", "server.mjs"]
