# syntax=docker/dockerfile:1

# ---- Builder: install dependencies and produce the standalone build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runner: serve the self-contained standalone output ----
FROM node:20-alpine AS runner
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
USER node
# `output: 'standalone'` emits a minimal server bundle (with its own node_modules)
# plus the static assets it needs to be copied alongside it.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/bin/sh", "-c", "wget -q --spider http://127.0.0.1:3001 || exit 1"]

CMD ["node", "server.js"]
