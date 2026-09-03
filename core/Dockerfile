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

# Document text extraction for the `documents` skill: markitdown, in its own virtualenv under
# /opt so nothing Python-side can collide with the harness. It reads pdf, docx, pptx and xlsx
# (plus html, csv, json, xml, epub and zip) and prints Markdown on stdout — pi's own `read` tool
# handles images only, so without this Core cannot open a document at all.
#
# uv brings its own standalone CPython (this image has no system Python) — UV_PYTHON_INSTALL_DIR
# puts it under /opt instead of root's home, and the chmod makes both readable for the non-root
# runtime user. --no-cache keeps uv's download cache out of the layer.
COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
ARG MARKITDOWN_VERSION=0.1.7
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python
RUN uv venv --python 3.12 /opt/doctools \
    && uv pip install --no-cache --python /opt/doctools/bin/python \
      "markitdown[pdf,docx,pptx,xlsx]==${MARKITDOWN_VERSION}" \
    && chmod -R a+rX /opt/uv-python /opt/doctools \
    && /opt/doctools/bin/markitdown --help > /dev/null

# The web chat UI: our patched build of @agegr/pi-web. It drives pi through the SDK
# in-process, so it must live in THIS image — Core's skills shell out to git, jq, gh and yt-dlp
# above, and a plain node image would not have them.
#
# Installed from a tarball, not the registry, because we carry two patches upstream does not
# have (see ../webui/): a camera button for the phone, and a title generator that stops
# re-sending Core's entire system prompt to name a chat.
#
# Build the tarball on a machine with node — the Pi has none, and a Next build wants more RAM
# than it has spare:
#     ./webui/build.sh
#     scp core/vendor/pi-web.tgz rpi@rpi:personal-assistant/core/vendor/
#
# The tarball is git-ignored. Its .next output carries no native binaries, so it is portable
# between architectures; npm still installs the runtime dependencies here, for this arch.
COPY vendor/pi-web.tgz /tmp/pi-web.tgz
RUN npm install -g /tmp/pi-web.tgz && rm -f /tmp/pi-web.tgz

WORKDIR /app
# Skills write scratch files to the working dir, so /app must be writable by the non-root
# runtime user.
RUN chown node:node /app

# The Pi harness operates in the /app directory
# Volumes are mapped in docker-compose.yml
CMD ["tail", "-f", "/dev/null"]
