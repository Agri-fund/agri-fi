# API Versioning Strategy

## Overview

The Agri-Fi API uses URI-based versioning with path prefixes (`/api/v1`, `/api/v2`).

## Current Versions

| Version | Status | Base Path | Notes |
|---------|--------|-----------|-------|
| v1 | **Active** | `/v1/*` | Current stable API |
| v2 | Planned | `/v2/*` | Future breaking changes |

## Version Selection

### URI Path Prefix (Primary)

All endpoints are prefixed with the version number:

```
GET /v1/trade-deals
GET /v1/users/me
POST /v1/auth/login
```

### Header Fallback

Clients can also specify the version via the `Accept` header:

```
Accept: application/vnd.agri-fi.v1+json
```

## Deprecation Policy

When a version is deprecated:

1. Response includes `Deprecation: true` header
2. Response includes `Sunset: <date>` header (RFC 8594)
3. Deprecated version maintained for **12 months** after next version GA
4. Clients receive notification via email and API response headers

## Response Headers

All responses include:

- `API-Version: v1` — Confirms which version served the request

## Migration Guide

### v1 → v2 (Future)

When v2 is released:

1. All existing endpoints remain at `/v1/*`
2. New breaking-change endpoints available at `/v2/*`
3. Frontend updated to use `/v2/*` prefix
4. Deprecation headers added to v1 responses

## OpenAPI Documentation

Each version has its own OpenAPI spec:

- v1: `/v1/docs` (Swagger UI)
- v2: `/v2/docs` (when available)

## Client Implementation

### Frontend (Next.js)

The frontend automatically prefixes all API calls with `/v1`:

```typescript
// frontend/src/config/backend.ts
const API_VERSION = '/v1';

// All calls automatically versioned
fetchBackend('/auth/login', { ... })  // → /v1/auth/login
fetchBackend('/users/me', { ... })    // → /v1/users/me
```

### Backend (NestJS)

Controllers are decorated with `@Version('1')`:

```typescript
@Version('1')
@Controller('auth')
export class AuthController { ... }
```

## Testing

Both versions should pass integration tests:

```bash
# Test v1
curl http://localhost:3001/v1/health

# Test version header
curl -H "Accept: application/vnd.agri-fi.v1+json" http://localhost:3001/health
```
