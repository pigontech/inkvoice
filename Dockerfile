FROM oven/bun:1 AS builder

WORKDIR /app

# Install dependencies
COPY package.json bun.lock bunfig.toml ./
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN bun install --frozen-lockfile

# Copy source
COPY packages/backend packages/backend
COPY packages/frontend packages/frontend

# Build frontend
RUN cd packages/frontend && bun run build

# Production image
FROM oven/bun:1-slim

WORKDIR /app

# Copy package files and install production deps only
COPY --from=builder /app/package.json package.json
COPY --from=builder /app/bun.lock bun.lock
COPY --from=builder /app/bunfig.toml bunfig.toml
COPY --from=builder /app/packages/backend/package.json packages/backend/package.json
COPY --from=builder /app/packages/frontend/package.json packages/frontend/package.json
RUN bun install --production --frozen-lockfile

# Copy built files
COPY --from=builder /app/packages/backend/src packages/backend/src
COPY --from=builder /app/packages/frontend/dist packages/frontend/dist
COPY templates templates

# Create data directory
RUN mkdir -p /app/data

# Environment defaults
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/invoice.db
ENV NODE_ENV=production

# Health check using bun fetch (no curl in slim image)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 3000

CMD ["bun", "run", "packages/backend/src/index.ts"]
