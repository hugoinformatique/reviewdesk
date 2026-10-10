# ReviewDesk self-host image. Official Node image pinned by version and digest.
FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Production dependencies only, exactly as locked; no install scripts run.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json entrypoint.mjs runtime-config.mjs ./
COPY dist ./dist
COPY public ./public
EXPOSE 4300
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4300/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "/app/entrypoint.mjs"]
