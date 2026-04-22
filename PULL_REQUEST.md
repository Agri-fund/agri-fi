# fix(auth): validate Stellar public key on wallet link

Closes #61

## Problem

`AuthService.linkWallet()` accepted any string as `walletAddress` with no
format validation. An invalid value stored in the database would silently pass
all upstream checks (the `walletAddress` truthy-check in `EscrowService`) and
only fail deep inside `StellarService.releaseEscrow()` when
`Operation.payment({ destination: "<invalid>" })` throws — after the deal is
already in `delivered` state, escrow funds are locked, and the farmer is never
paid.

## What changed

### `backend/src/auth/dto/wallet.dto.ts`
- Added `@IsStellarPublicKey()` custom decorator using `registerDecorator` from
  `class-validator`. It calls `Keypair.fromPublicKey(value)` from `stellar-sdk`
  and returns `false` if it throws — the same validation the SDK uses internally.
- Added `@ApiProperty` with description and example for Swagger documentation.
- Kept existing `@IsString()` as a first-pass type guard.

### `backend/src/main.ts`
- Added `exceptionFactory` to the global `ValidationPipe` so that an
  `isStellarPublicKey` constraint failure returns the shaped error body the
  issue requires:
  ```json
  { "code": "INVALID_WALLET_ADDRESS", "message": "walletAddress must be a valid Stellar public key." }
  ```
  All other validation errors continue to use the default NestJS format.
- Wired up `SwaggerModule` at `/api/docs` so `@ApiProperty` decorators are
  served.

### `backend/src/auth/dto/wallet.dto.spec.ts` *(new)*
Unit tests for the custom validator using `class-validator`'s `validate()`
directly:
- valid Stellar public key → 0 errors
- plain string → `isStellarPublicKey` constraint error
- Stellar secret key (`S...`) → constraint error
- empty string → error
- key truncated by 1 char → constraint error

### `backend/src/auth/auth.service.spec.ts`
- Replaced the invalid test key `'GABC123'` in the `linkWallet` test with a
  real `stellar-sdk v12` generated public key.
- Added a second `linkWallet` test: `NotFoundException` when user does not
  exist.

### `backend/src/database/migrations/1699900000007-ValidateWalletAddresses.ts` *(new)*
Two-step migration:
1. **Nullifies** any existing `wallet_address` rows that do not match
   `^G[A-Z2-7]{55}$` (the Stellar public key regex). Affected users will need
   to re-link their wallet — safer than blocking the migration or deleting
   accounts.
2. **Adds a `CHECK` constraint** (`chk_wallet_address_stellar`) on the column
   so the database itself enforces the format going forward, independent of the
   application layer.

`down()` drops the constraint only (the nullified rows are not restored — they
were already invalid).

## How to migrate

```bash
cd backend
npm run migration:run
```

The migration is safe to run against a live database. The `UPDATE` runs first
(nullifying bad rows), then the `ALTER TABLE` adds the constraint. If no rows
have invalid wallet addresses the `UPDATE` is a no-op.

To verify before running:

```sql
-- Preview which rows would be nullified
SELECT id, email, wallet_address
FROM users
WHERE wallet_address IS NOT NULL
  AND wallet_address !~ '^G[A-Z2-7]{55}$';
```

## Testing

```bash
cd backend
npm test -- --testPathPattern="wallet.dto|auth.service" --no-coverage
```

Expected: **13 tests pass**, 0 failures.

## Acceptance criteria

| Criterion | How it is met |
|---|---|
| `POST /auth/wallet` with non-Stellar string → 400 `INVALID_WALLET_ADDRESS` | `@IsStellarPublicKey()` on DTO + `exceptionFactory` in `main.ts` |
| `POST /auth/wallet` with valid `G...` key → succeeds | `Keypair.fromPublicKey()` only passes for real keys |
| Custom validator unit-tested with valid and invalid inputs | `wallet.dto.spec.ts` — 5 cases |
| `WalletDto` documented in Swagger spec | `@ApiProperty` on field + `SwaggerModule` wired at `/api/docs` |
| Existing invalid wallet addresses handled | Migration 1699900000007 nullifies bad rows + adds DB CHECK constraint |
