# Database Seeding Safety Policy & Production Guardrails

## 1. Overview
Database seeding scripts (`backend/scripts/seed.ts` and `backend/scripts/batch-seed.ts`) contain destructive queries that clear database tables (`TRUNCATE` / `.delete({})`) and inject mock entities for local development and staging environments.

Running these scripts against a staging or production database with live funds or authentic investor data could cause irrecoverable data loss.

---

## 2. Guardrail Mechanisms

### Runtime Environment Check
Both `seed.ts` and `batch-seed.ts` evaluate the active execution environment:
- If `NODE_ENV === 'production'` or `APP_ENV === 'production'`, execution is terminated immediately with error exit code `1`.

### Explicit Override Protocol
In the rare event that an operator intentionally needs to seed a dedicated test environment running in production mode:
1. Must pass CLI flag `--force` (or `-f`).
2. Must set environment variable `CONFIRM_PROD_SEED=true`.

```bash
CONFIRM_PROD_SEED=true npm run db:seed -- --force
```

### Production Entrypoint Isolation
- `start:prod` in `backend/package.json` only runs `node -r dotenv-vault/config dist/main`.
- Container entrypoints in `backend/Dockerfile` and Kubernetes Helm/manifests do not execute seed hooks.

### Continuous Integration (CI)
The automated script `scripts/verify-seed-safety.sh` runs as part of CI via `npm run check:seed-safety` to prevent accidental inclusion of seed scripts in production deployment pipelines.
