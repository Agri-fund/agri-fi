## Summary

<!-- Briefly describe the purpose of this PR and what changes were introduced. -->

Closes #

## Type of Change

- [ ] 🐛 Bug fix (non-breaking change fixing an issue)
- [ ] ✨ New feature (non-breaking change adding functionality)
- [ ] 💥 Breaking change (fix or feature causing existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] 🗄️ Database migration
- [ ] ⛓️ Soroban smart contract update
- [ ] ⚙️ DevOps / CI / Infrastructure change

---

## Database Migrations Checklist

If this PR includes one or more database migrations, review and complete the checklist per [Migration Developer Guide](docs/development/migrations.md):

- [ ] File named `{timestamp}-{PascalCaseName}.ts` with matching class name & `name` property.
- [ ] `up()` and `down()` methods are completely symmetrical and revertible without manual fixes.
- [ ] Every new user- or tenant-owned table explicitly includes:
  - `ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;`
  - `ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;`
  - `CREATE POLICY "<table>_company_isolation" ... USING (...) WITH CHECK (...)`
- [ ] Tested locally with both `npm run migration:run` and `npm run migration:revert`.
- [ ] Tested against production-shaped data to verify index usage and table-lock duration.
- [ ] Entity definitions match the resulting schema.
- [ ] Updated ER diagram if required (`npm run doc:diagram`).

---

## Smart Contracts Checklist

If this PR touches Soroban smart contracts (`blockchain/**`), verify against [Extending Contracts Guide](docs/blockchain/extending-contracts.md):

- [ ] Compiles with `make build` and passes `make test`.
- [ ] State upgrades maintain backward storage layout compatibility.
- [ ] Authorization checks (`require_auth`) protect state-mutating functions.
- [ ] Event emissions match backend listener topics in `SorobanListenerService`.

---

## Testing & Quality Assurance

Refer to [Testing Strategy Guide](docs/testing/README.md):

- [ ] Unit tests added or updated.
- [ ] Integration / E2E tests pass locally.
- [ ] Linter passes (`npm run lint` / `pnpm run lint`).
- [ ] No merge conflicts or unresolved comments.
