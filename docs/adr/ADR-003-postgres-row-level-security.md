# ADR-003: Postgres Row Level Security (RLS) & RLS Service

* **Status:** Accepted
* **Date:** 2026-09-25
* **Authors:** Agri-Fi Core Architecture Team

---

## 1. Context and Problem Statement

Agri-Fi hosts multi-tenant and multi-role data (Farmers, Traders, Investors, Compliance Officers, Admins). Relying exclusively on application-level `WHERE user_id = ...` checks in SQL queries risks data leaks if a developer omits a scoping condition in new API endpoints.

We require database-enforced access boundaries to ensure users can strictly access only their authorized rows.

---

## 2. Decision Outcome

We adopted **PostgreSQL Row Level Security (RLS)** managed by NestJS `CLS` (AsyncLocalStorage) and a dedicated `RlsService`.

Key details:
1. Postgres tables containing tenant/user data (e.g. `investments`, `documents`, `kyc_submissions`) have `ENABLE ROW LEVEL SECURITY` policies applied in migrations.
2. NestJS request middleware extracts user session context (`tenant_id`, `user_id`, `role`) and sets Postgres session variables via `SET LOCAL app.current_user_id = ...` prior to executing queries within TypeORM transactions.
3. RLS policies evaluate `app.current_user_id` and bypass rules for admin bypass connections.

---

## 3. Consequences

### Positive Consequences
- **Defense in Depth:** Even if application code forgets a user ID filter in SQL, Postgres rejects unauthorized row reads/writes.
- **Centralized Security Enforcement:** Security rules are audited directly in DB migration scripts.

### Negative Consequences / Trade-offs
- **Connection Pooling Complexity:** PgBouncer must be configured in transaction pooling mode (`pool_mode = transaction`) and `SET LOCAL` must be reset per transaction.
- **Migration Discipline:** Developers must add RLS policies to all new tenant-facing database tables.

---

## 4. Alternatives Considered

1. **Option 1: Pure Application-Level Filtering in ORM Repositories**
   - *Pros:* Simpler DB setup without session variables.
   - *Cons:* Vulnerable to human error when writing raw queries or custom repository methods.
   - *Reason for rejection:* Failed defense-in-depth security requirement for financial data.

2. **Option 2: Separate Postgres Database per Tenant**
   - *Pros:* Physical isolation.
   - *Cons:* Extreme operational complexity and cost overhead for thousands of users.
   - *Reason for rejection:* Unscalable for platform user volume.
