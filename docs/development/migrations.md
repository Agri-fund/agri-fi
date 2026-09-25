# TypeORM Migration Developer Guide

This guide describes how to author, name, verify, and roll back TypeORM database migrations in Agri-Fi, with a strict emphasis on PostgreSQL Row Level Security (RLS) enforcement and non-disruptive production deployment.

---

## Table of Contents

1. [Architecture & Principles](#architecture--principles)
2. [When to Use `migration:generate` vs Manual Authoring](#when-to-use-migrationgenerate-vs-manual-authoring)
3. [Naming Conventions & Structure](#naming-conventions--structure)
4. [Row Level Security (RLS) Enforcement (Mandatory)](#row-level-security-rls-enforcement-mandatory)
   - [The Multi-Tenant Context Model](#the-multi-tenant-context-model)
   - [Mandatory RLS Migration Boilerplate](#mandatory-rls-migration-boilerplate)
   - [Security Caveats & Gotchas](#security-caveats--gotchas)
5. [Rollback Strategy & Up/Down Symmetry](#rollback-strategy--updown-symmetry)
6. [Testing Against Production-Shaped Data](#testing-against-production-shaped-data)
7. [Operational Best Practices for Zero-Downtime Migrations](#operational-best-practices-for-zero-downtime-migrations)
8. [Pull Request Checklist](#pull-request-checklist)

---

## 1. Architecture & Principles

Agri-Fi enforces `synchronize: false` across all environments. Every database schema or data modification must be applied through a version-controlled TypeORM migration file in `backend/src/database/migrations/`.

- **Source of Truth**: The TypeScript entity classes in `backend/src/**/entities/*.entity.ts` define desired application models, while migration files define the explicit path to transition PostgreSQL schemas.
- **Transactional Migrations**: TypeORM runs each migration in an individual database transaction (`BEGIN ... COMMIT`). If any statement fails, the transaction rolls back completely.
- **Strict Determinism**: Migrations must produce identical schema states regardless of when or where they are executed.

---

## 2. When to Use `migration:generate` vs Manual Authoring

### Use `migration:generate` for:

- Routine entity schema synchronizations:
  - Adding non-security-critical nullable columns.
  - Adding or modifying column types.
  - Adding standard foreign key relationships.

```bash
cd backend
npm run typeorm migration:generate -- -d src/database/data-source.ts src/database/migrations/AddAvatarUrlToUsers
```

> [!WARNING]
> **Always inspect auto-generated migrations!** TypeORM's generator often attempts to drop and recreate custom PostgreSQL ENUMs, composite primary keys, or RLS policies. Never commit a generated migration without line-by-line review.

### Use Handwritten (Manual) Migrations for:

- **Any new tenant-facing or user-scoped table** (must attach RLS policies).
- **Data migrations / backfills** (populating new columns before applying `NOT NULL` constraints).
- **Custom indexes** (partial indexes, expression indexes, or `CONCURRENTLY` index builds).
- **Custom PostgreSQL functions, triggers, or schemas** (e.g. `app.user_in_current_company`).
- **Security-critical permission grants or role configurations**.

To scaffold an empty migration file:

```bash
cd backend
npm run typeorm migration:create src/database/migrations/CompleteComplianceAuditRLS
```

---

## 3. Naming Conventions & Structure

### File Name Format

`{timestamp}-{PascalCaseDescription}.ts`

- **Timestamp**: Strictly increasing 13-digit millisecond timestamp (e.g., `1950000000000`, `1950000000001`). Using sequential or timestamp-based numbers prevents collation conflicts.
- **Description**: Concise PascalCase summarizing the intent.
- Examples from codebase:
  - `1940000000000-AddReceiptUrlToInvestments.ts`
  - `1950000000000-CompleteInvestorRLS.ts`
  - `1950000000001-AddPartialIndexesForActiveTradeDealsAndOpenInvestments.ts`

### Class Structure

The exported class name must match `{PascalCaseDescription}{timestamp}` and set `name = '{PascalCaseDescription}{timestamp}'`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceiptUrlToInvestments1940000000000 implements MigrationInterface {
  name = 'AddReceiptUrlToInvestments1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "investments" ADD COLUMN IF NOT EXISTS "receipt_url" VARCHAR`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "investments" DROP COLUMN IF EXISTS "receipt_url"`,
    );
  }
}
```

---

## 4. Row Level Security (RLS) Enforcement (Mandatory)

### The Multi-Tenant Context Model

As documented in [ADR-003](../adr/ADR-003-postgres-row-level-security.md), Agri-Fi relies on PostgreSQL Row Level Security (RLS) to enforce tenant and company boundaries. 

During request handling, the NestJS application sets the active session context:
```sql
SET LOCAL app.current_company_id = '<company-uuid>';
```

Every query executed against tables containing tenant, user, or investment data is evaluated against this variable by the database engine.

### Mandatory RLS Migration Boilerplate

Whenever you create a new table storing tenant, user, investor, or farmer data (e.g., `farmer_profiles`, `deal_reviews`, `payout_records`), you **must** apply RLS:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFarmerProfilesTable1950000000005 implements MigrationInterface {
  name = 'CreateFarmerProfilesTable1950000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create table
    await queryRunner.query(`
      CREATE TABLE "farmer_profiles" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "farm_name" VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Enable & Force RLS
    await queryRunner.query(`ALTER TABLE "farmer_profiles" ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE "farmer_profiles" FORCE ROW LEVEL SECURITY;`);

    // 3. Create Isolation Policy
    await queryRunner.query(`
      DROP POLICY IF EXISTS "farmer_profiles_company_isolation" ON "farmer_profiles";
      CREATE POLICY "farmer_profiles_company_isolation" ON "farmer_profiles"
        USING (app.user_in_current_company("user_id"))
        WITH CHECK (app.user_in_current_company("user_id"));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse policy, RLS, and table in down
    await queryRunner.query(`DROP POLICY IF EXISTS "farmer_profiles_company_isolation" ON "farmer_profiles";`);
    await queryRunner.query(`ALTER TABLE "farmer_profiles" DISABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "farmer_profiles";`);
  }
}
```

### Security Caveats & Gotchas

1. **Always use `FORCE ROW LEVEL SECURITY`**:
   - `ENABLE ROW LEVEL SECURITY` only restricts non-owner roles.
   - Without `FORCE ROW LEVEL SECURITY`, connections using the database table owner role (such as the default migration runner or microservice credentials) bypass policies entirely.
2. **Include both `USING` and `WITH CHECK` clauses**:
   - `USING` gates `SELECT`, `UPDATE`, and `DELETE` queries.
   - `WITH CHECK` gates `INSERT` and `UPDATE` payload validation to prevent users from inserting records belonging to a different tenant.
3. **Never bypass `rls.service` / CLS context**:
   - Queries executed without setting `app.current_company_id` will return zero rows if RLS is enabled, or could leak cross-tenant data if RLS was omitted.
4. **Always write a migration test for RLS changes**:
   - See `backend/src/database/migrations/1950000000000-CompleteInvestorRLS.spec.ts` for reference. Test queries under authenticated company contexts, different company contexts, and unauthenticated contexts.

---

## 5. Rollback Strategy & Up/Down Symmetry

Every migration PR must provide a reliable rollback path:

- **Exact Inverse Operations**:
  - `ADD COLUMN` in `up()` $\rightarrow$ `DROP COLUMN IF EXISTS` in `down()`.
  - `CREATE TABLE` in `up()` $\rightarrow$ `DROP POLICY`, `DISABLE RLS`, `DROP TABLE IF EXISTS` in `down()`.
  - `CREATE INDEX` in `up()` $\rightarrow$ `DROP INDEX IF EXISTS` in `down()`.
- **Preserving Data Integrity on Rollback**:
  - Avoid destructive operations in production. If rolling back a feature in production, prefer additive migrations over dropping populated columns.
- **Local Verification**:
  Always test both directions locally before committing:
  ```bash
  # Apply migration
  npm run migration:run
  
  # Revert migration
  npm run migration:revert
  
  # Re-apply migration
  npm run migration:run
  ```

---

## 6. Testing Against Production-Shaped Data

In production, tables like `investments`, `transaction_logs`, and `users` contain millions of rows. Migrations that run in milliseconds in local development can lock tables for minutes in production if written incorrectly.

### Avoiding Table Locks

1. **Adding Columns with Defaults**:
   - In modern PostgreSQL (>= 11), adding a column with a constant default (`ALTER TABLE ... ADD COLUMN ... DEFAULT 'foo' NOT NULL`) is a fast metadata-only operation without rewrites.
   - For volatile defaults (e.g. `DEFAULT clock_timestamp()`), add the column as nullable first, backfill in batches, and then alter to `SET NOT NULL`.
2. **Index Creation**:
   - Standard `CREATE INDEX` acquires an `ACCESS EXCLUSIVE` lock, preventing writes and reads.
   - For production hot tables, run large indexes with `CREATE INDEX CONCURRENTLY` in non-transactional migrations (`@Transaction(false)`).
3. **Foreign Key Constraints**:
   - Add constraints with `NOT VALID` first (instant lock), then validate in a follow-up statement (`ALTER TABLE ... VALIDATE CONSTRAINT ...`) which only acquires `SHARE UPDATE EXCLUSIVE`.

---

## 7. Operational Best Practices for Zero-Downtime Migrations

1. **Phase 1 (Expand)**:
   - Add new columns / tables as nullable or with safe defaults.
   - Deploy backend code that reads from old columns but writes to both old and new.
2. **Phase 2 (Backfill)**:
   - Run background backfill scripts for existing rows.
3. **Phase 3 (Contract)**:
   - Switch application code to read exclusively from new columns.
   - Deploy follow-up migration to add `NOT NULL` constraints and drop old columns.

---

## 8. Pull Request Checklist

Every pull request containing database migrations must satisfy the following criteria:

- [ ] Migration filename follows `{timestamp}-{PascalCaseName}.ts` convention.
- [ ] Migration class name matches `{PascalCaseName}{timestamp}`.
- [ ] `name = '{PascalCaseName}{timestamp}'` is explicitly set in class body.
- [ ] Every new user- or tenant-owned table has `ENABLE ROW LEVEL SECURITY;` and `FORCE ROW LEVEL SECURITY;`.
- [ ] RLS policies include both `USING` and `WITH CHECK` clauses.
- [ ] Migration has been tested both forwards (`migration:run`) and backwards (`migration:revert`).
- [ ] Any new foreign keys or filter predicates include corresponding database indexes.
- [ ] Entity definitions in `src/**/entities/*.entity.ts` match the migration schema exactly.
- [ ] Updated schema ER diagram (`npm run doc:diagram`).
- [ ] No table-locking queries executed without concurrency guards.
