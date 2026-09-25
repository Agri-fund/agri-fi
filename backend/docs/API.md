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

## SEP-12 Customer Schema

The KYC endpoints implement the Stellar SEP-12 customer schema. The platform's
internal field names are mapped automatically (#837):

| Platform field      | SEP-12 field            |
|---------------------|-------------------------|
| `firstName`         | `first_name`            |
| `lastName`          | `last_name`             |
| `dateOfBirth`       | `birth_date`            |
| `nationalIdNumber`  | `id_number`             |
| `nationalIdType`    | `id_type`               |
| `addressLine1`      | `address.line1`         |
| `countryCode`       | `address.country_code`  |

Both formats are accepted by `PUT /v1/kyc/customer` and both are stored; the
SEP-12 payload is persisted alongside the internal record.

### Endpoints

```
PUT  /v1/kyc/customer        Submit or update customer fields (internal or SEP-12 names)
GET  /v1/kyc/customer        Get the caller's SEP-12 compliant record
GET  /v1/kyc/customer/:id    Get a customer by id (admins only)
```

### Validation

- `birth_date` / `dateOfBirth` must be an ISO 8601 date (`YYYY-MM-DD`)
- `address.country_code` / `countryCode` and `id_country_code` must be
  ISO 3166-1 alpha-2 codes

### Example response (`GET /v1/kyc/customer`)

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "VERIFIED",
  "first_name": "Ada",
  "last_name": "Investor",
  "email_address": "ada@example.com",
  "birth_date": "1990-05-20",
  "address": {
    "line1": "1 Market Street",
    "country_code": "NG"
  },
  "id_type": "national_id",
  "id_number": "12345678"
}
```
