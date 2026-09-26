# Backend Dockerfile & Container Healthcheck Alignment

## 1. Overview
To prevent flapping health status during container boot sequences (such as database migrations, DI graph building, and connection pool initialization), the backend Docker container and docker-compose configurations are hardened with:
- **Consistent Listener Port**: Explicitly configured to port `3001` via `ENV PORT=3001` and `EXPOSE 3001`.
- **Readiness vs Liveness Endpoint**: Probes use `/v1/health` readiness route ensuring all backing dependencies (PostgreSQL, RabbitMQ, memory/disk thresholds) are verified before traffic is routed.
- **Extended Startup Grace Period**: `start-period=60s` (or 60–90s) is allocated before probe failures count towards container failure retries.

---

## 2. Dockerfile Specification
```dockerfile
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["/bin/sh", "-c", "wget -q --spider http://127.0.0.1:3001/v1/health || exit 1"]

CMD ["node", "dist/src/main.js"]
```

---

## 3. Docker Compose Configuration
```yaml
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```
