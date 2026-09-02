# ---- main image: Node 22 for the pi harness (pinned for reproducible builds) ----
FROM node:22.22.3-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install the Pi Coding Agent, pinned to a tested version.
RUN npm install -g @earendil-works/pi-coding-agent@0.84.4

# yt-dlp (pinned) for the youtube skill — self-contained Linux binary, no Python/ffmpeg.
# The skill downloads only caption tracks and cleans them to text in Node. Arch-aware so the
# same Dockerfile builds on amd64 (dev) and arm64 (Raspberry Pi).
ARG YT_DLP_VERSION=2026.06.09
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
         amd64) ytdlp=yt-dlp_linux ;; \
         arm64) ytdlp=yt-dlp_linux_aarch64 ;; \
         *) echo "unsupported arch for yt-dlp: $arch" >&2; exit 1 ;; \
       esac \
    && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${ytdlp}" \
      -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# GitHub CLI (pinned) for the github-pages skill — official Linux binary, like yt-dlp.
# dpkg's arch name (amd64/arm64) matches gh's release asset naming directly.
ARG GH_VERSION=2.94.0
RUN arch="$(dpkg --print-architecture)" \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.tar.gz" \
      | tar -xz -C /tmp \
    && mv "/tmp/gh_${GH_VERSION}_linux_${arch}/bin/gh" /usr/local/bin/gh \
    && rm -rf "/tmp/gh_${GH_VERSION}_linux_${arch}" \
    && gh --version

# TRIAL BRANCH — one of three web chat UIs under evaluation (see README). This one is a
# Next.js app that drives pi through the SDK in-process, so it must live in THIS image: Core's
# skills shell out to git, jq, gh and yt-dlp above, and a plain node image would not have them.
# No native modules, so no build toolchain and no --allow-scripts is needed on arm64.
ARG PI_WEB_VERSION=0.8.11
RUN npm install -g "@agegr/pi-web@${PI_WEB_VERSION}"

WORKDIR /app
# Skills write scratch files to the working dir, so /app must be writable by the non-root
# runtime user.
RUN chown node:node /app

# The Pi harness operates in the /app directory
# Volumes are mapped in docker-compose.yml
CMD ["tail", "-f", "/dev/null"]
