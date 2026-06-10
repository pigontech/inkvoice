FROM oven/bun:1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome path for PDF generation
ENV CHROME_PATH=/usr/bin/chromium

# Create workspace
WORKDIR /workspace
