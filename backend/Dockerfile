# syntax=docker/dockerfile:1

# ---- Builder: install all dependencies and compile the NestJS app ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Deps: resolve production-only dependencies for the final image ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Runner: minimal image carrying only prod deps + build artifacts ----
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
USER node
COPY --chown=node:node package*.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/bin/sh", "-c", "wget -q --spider http://127.0.0.1:3000/health || exit 1"]

# nest build (no explicit rootDir) emits the entry at dist/src/main.js.
CMD ["node", "dist/src/main.js"]
