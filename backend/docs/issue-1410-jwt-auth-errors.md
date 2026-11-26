# Issue #1410: Structured JWT authentication failures

## Status

- Scope: Backend authentication
- Change type: Bug fix / documentation
- Repository: `Kabukabs/agri-fi` fork
- Upstream: `Agri-fund/agrifi`

## Problem

The JWT authentication guard currently returns a bare `401 Unauthorized` response when a token is expired or otherwise rejected. This gives the frontend no machine-readable reason, so it cannot distinguish:

- A user who was previously authenticated but has an expired session
- A user who supplied an invalid or malformed token
- A user who did not supply a token

## Acceptance criteria

For protected endpoints:

- Expired tokens return HTTP `401` with:

  ```json
  {
    "code": "TOKEN_EXPIRED",
    "message": "Your session has expired. Please log in again."
  }
  ```

- Invalid or malformed tokens return HTTP `401` with:

  ```json
  {
    "code": "TOKEN_INVALID"
  }
  ```

- Missing tokens return HTTP `401` with:

  ```json
  {
    "code": "TOKEN_MISSING"
  }
  ```

## Proposed implementation

1. Locate the JWT guard used for protected NestJS routes.
2. Check for a missing authorization header before calling JWT verification.
3. Preserve JWT verification error details, especially the `TokenExpiredError` case.
4. Return a structured `401 Unauthorized` response body using the relevant code above.
5. Ensure only authentication failures receive these bodies; authorization failures remain unchanged.
6. Add unit or e2e coverage for expired, malformed/invalid, and missing tokens.

## Suggested test matrix

| Scenario | Authorization header | Expected status | Expected code |
|---|---|---:|---|
| Missing token | None | 401 | `TOKEN_MISSING` |
| Malformed token | `Bearer not-a-jwt` | 401 | `TOKEN_INVALID` |
| Invalid signature | `Bearer <invalid-signed-token>` | 401 | `TOKEN_INVALID` |
| Expired token | `Bearer <expired-token>` | 401 | `TOKEN_EXPIRED` |

## Security considerations

- Do not expose raw JWT library error strings or token contents.
- Keep response behavior consistent across protected REST endpoints.
- Do not log bearer tokens.
- Preserve any existing CORS, cookie, or bearer-token authentication behavior.

## Related locations

- JWT strategy: `backend/src/auth/jwt.strategy.ts`
- Authentication module: `backend/src/auth/auth.module.ts`
- Optional JWT guard: `backend/src/auth/optional-jwt.guard.ts`
- Auth guard directory: `backend/src/auth/guards/`
