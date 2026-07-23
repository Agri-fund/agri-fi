# API Documentation — Agri-Fi

## Overview

The Agri-Fi API provides REST endpoints for the agricultural trade finance platform. The API supports:

- **User Management**: Registration, authentication, KYC verification
- **Trade Deals**: Create and browse agricultural commodity deals
- **Investments**: Fund trade deals and manage investment portfolios
- **Stellar Integration**: Blockchain-based escrow and token issuance
- **Document Management**: Upload and anchor documents via IPFS
- **Shipment Tracking**: Record and track delivery milestones
- **Admin Functions**: KYC approvals, user role management

## Accessing Swagger UI

### Development
```bash
http://localhost:3001/api/docs
```

### Production
```bash
https://api.agri-fi.example.com/api/docs
```

**Production requires HTTP Basic Authentication:**
- Username: `admin` (or configured `SWAGGER_USER`)
- Password: Set via `SWAGGER_PASS` environment variable

## OpenAPI Specification

The complete OpenAPI 3.0 specification is available in `openapi.json`:

```bash
# View the specification
cat openapi.json

# Generate TypeScript client (using openapi-generator-cli)
openapi-generator-cli generate -i openapi.json -g typescript-axios -o ./api-client
```

## Authentication

All endpoints except `/auth/register`, `/auth/login`, and `GET /trade-deals` require JWT authentication:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:3001/api/endpoint
```

### Getting a JWT Token

1. **Register**:
```bash
POST /auth/register
{
  "name": "Amara Diallo",
  "email": "amara@example.com",
  "password": "securePass1",
  "role": "trader",
  "country": "KE"
}
```

2. **Login**:
```bash
POST /auth/login
{
  "email": "amara@example.com",
  "password": "securePass1"
}

# Response:
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

## Key Endpoints

### Authentication
- `POST /auth/register` — Register a new user
- `POST /auth/login` — Authenticate and receive JWT
- `POST /auth/wallet` — Link Stellar wallet address
- `POST /auth/kyc` — Submit KYC verification

### Trade Deals
- `GET /trade-deals` — List open deals (marketplace)
- `POST /trade-deals` — Create a draft deal
- `POST /trade-deals/:id/publish` — Publish a deal (token issuance)

### Investments
- `GET /investments/my-investments` — Get investor's investments
- `POST /investments` — Create an investment
- `POST /investments/:id/fund` — Fund investment via escrow

### Stellar
- `POST /stellar/submit` — Submit signed XDR transaction

### Documents
- `POST /documents` — Upload document to IPFS

### Users
- `GET /users/me` — Get current user profile
- `GET /users/me/deals` — Get user's deals

### Admin
- `POST /admin/kyc/:userId/approve` — Approve KYC
- `POST /admin/users/:userId/role` — Update user role

## Generating API Client

Using the `openapi.json` specification, you can auto-generate typed API clients:

### TypeScript/JavaScript
```bash
npm install @openapi-generator-cli/core
npx openapi-generator-cli generate \
  -i openapi.json \
  -g typescript-axios \
  -o ./generated-api-client
```

### Frontend Integration
```typescript
import { Configuration, DefaultApi } from './generated-api-client';

const config = new Configuration({
  basePath: 'http://localhost:3001',
  accessToken: jwtToken,
});

const api = new DefaultApi(config);
const investments = await api.getMyInvestments();
```

## Response Format

All responses follow a consistent format:

### Success (2xx)
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "amara@example.com",
  "role": "trader",
  "kycStatus": "verified",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Error (4xx/5xx)
```json
{
  "statusCode": 400,
  "message": "quantity must be at least 1",
  "error": "Bad Request"
}
```

## Validation

Request bodies are automatically validated. Common validation errors:

- **delivery_date in the past** → 400 Bad Request
- **quantity <= 0** → 400 Bad Request
- **total_value < 100** → 400 Bad Request
- **Invalid email** → 400 Bad Request
- **Password < 8 characters** → 400 Bad Request
- **Invalid JWT token** → 401 Unauthorized
- **User role not allowed** → 403 Forbidden

## Rate Limiting

The Stellar submission endpoint is rate-limited:

- Limit: 5 requests per 60 seconds
- Header: `X-RateLimit-Remaining`

## Environment Variables

```bash
# Server
PORT=3001
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:pass@host:5432/agri_fi

# Authentication
JWT_SECRET=your-secret-key-here

# Swagger/Docs (Production only)
SWAGGER_USER=admin
SWAGGER_PASS=your-strong-password

# Stellar
STELLAR_NETWORK=testnet  # or mainnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_PLATFORM_SECRET=S...

# Queue
RABBITMQ_URL=amqp://localhost:5672

# Storage
IPFS_API_URL=http://localhost:5001

# Encryption
ENCRYPTION_KEY=32-character-key-for-aes256!
```

## CI/CD Integration

The OpenAPI specification is automatically generated during the build process:

```bash
# Generate spec and include in build artifact
npm run build:docs

# Spec is committed to the repository
git add openapi.json
git commit -m "docs: update OpenAPI specification"
```

## Support

For API issues, bugs, or feature requests, please open an issue on GitHub with:
- Endpoint and HTTP method
- Request body (sanitized)
- Error response
- Environment (dev/staging/prod)

## See Also

- [Backend Setup Guide](./docs/README.md)
- [Database Schema](./docs/database-performance.md)
- [Logging Examples](./docs/logging-examples.md)
