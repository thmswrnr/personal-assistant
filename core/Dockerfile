# Use Node.js 22 as the base image for the Pi harness
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install the verified Pi Coding Agent and ACPX (Headless bridge)
RUN npm install -g @earendil-works/pi-coding-agent acpx

WORKDIR /app

# The Pi harness operates in the /app directory
# Volumes are mapped in docker-compose.yml
CMD ["tail", "-f", "/dev/null"]
