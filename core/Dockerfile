# Use Node.js 22 as the base image for the Pi harness (pinned for reproducible builds)
FROM node:22.22.3-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install the Pi Coding Agent and ACPX (headless bridge), pinned to tested versions.
# acpx is alpha and changes frequently, so pinning here is what keeps rebuilds stable.
RUN npm install -g @earendil-works/pi-coding-agent@0.79.1 acpx@0.10.0

# yt-dlp (pinned) for the youtube skill — self-contained Linux binary, no Python/ffmpeg.
# The skill downloads only caption tracks and cleans them to text in Node.
ARG YT_DLP_VERSION=2026.06.09
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux" \
      -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# The Pi harness operates in the /app directory
# Volumes are mapped in docker-compose.yml
CMD ["tail", "-f", "/dev/null"]
