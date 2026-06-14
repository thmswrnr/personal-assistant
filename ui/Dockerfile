# Core dashboard: Node + pi SDK. Same pinned base as the harness.
FROM node:22.22.3-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app/ui

# Install deps (pi SDK) into the image — pinned + cached. The app code (server.mjs,
# public/) is mounted from the repo at runtime, so it preserves this node_modules.
COPY package.json ./
RUN npm install --omit=dev --no-fund --no-audit

EXPOSE 3000
CMD ["node", "server.mjs"]
