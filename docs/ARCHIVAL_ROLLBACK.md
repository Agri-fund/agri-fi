# Data Archival Rollback Procedure

This document defines the emergency operational procedure for rolling back data archival in the event of job failure, partial database transaction abort, or data discrepancy detected during archival validation.

---

## 1. Overview & Failure Modes

Archival works via a 3-stage process:
1. **Soft Archival**: Closed deals (>2 years old) are copied to `trade_deals_archive`, `investments_archive`, and `shipment_milestones_archive`, and primary records have `deleted_at` set to `NOW()`.
2. **Checksum Validation**: Row count and SHA-256 hash comparison between primary soft-deleted rows and archive tables.
3. **Hard Deletion**: Purges soft-deleted primary records older than 30 days ONLY if validation passes.

### Potential Failure Modes:
- **Mid-run Transaction Abort**: Automatically rolled back by PostgreSQL transaction block.
- **Validation Mismatch**: SHA-256 hash or row count does not match.
- **Accidental Soft-Archival**: Valid deals soft-archived erroneously.

---

## 2. Immediate Triage & Diagnostics

Check archival metrics & logs:
```bash
# Check Prometheus metrics
curl -s http://localhost:3001/metrics | grep archival

# Inspect backend service logs
grep -i "ArchivalService" /var/log/agri-fi/backend.log
```

Execute manual validation check:
```sql
SELECT 
  (SELECT COUNT(*) FROM trade_deals WHERE deleted_at IS NOT NULL) AS soft_deleted_primary,
  (SELECT COUNT(*) FROM trade_deals_archive) AS archived_deals;
```

---

## 3. Rollback Procedure: Restoring Soft-Archived Records

If records were soft-archived and need to be restored to active status without purging archive tables:

### Step 3.1: Restore Primary Table Records
Clear the `deleted_at` field on primary tables for the affected deal UUIDs:

```sql
BEGIN;

-- Restore trade deals
UPDATE trade_deals 
SET deleted_at = NULL 
WHERE id IN (SELECT id FROM trade_deals_archive WHERE archived_at > NOW() - INTERVAL '1 day');

-- Restore associated investments
UPDATE investments 
SET deleted_at = NULL 
WHERE trade_deal_id IN (SELECT id FROM trade_deals_archive WHERE archived_at > NOW() - INTERVAL '1 day');

-- Restore associated shipment milestones
UPDATE shipment_milestones 
SET deleted_at = NULL 
WHERE trade_deal_id IN (SELECT id FROM trade_deals_archive WHERE archived_at > NOW() - INTERVAL '1 day');

COMMIT;
```

### Step 3.2: Clean Up Unvalidated Archive Entries
If the archive records were corrupt or created partially:

```sql
BEGIN;

DELETE FROM shipment_milestones_archive WHERE archived_at > NOW() - INTERVAL '1 day';
DELETE FROM investments_archive WHERE archived_at > NOW() - INTERVAL '1 day';
DELETE FROM trade_deals_archive WHERE archived_at > NOW() - INTERVAL '1 day';

COMMIT;
```

---

## 4. Rollback Procedure: Restoring Hard-Deleted Records (Disaster Recovery)

If records were hard-deleted after 30 days and must be restored from archive:

```sql
BEGIN;

-- Re-insert trade deals from archive
INSERT INTO trade_deals (
  id, commodity, quantity, quantity_unit, total_value, token_count, token_symbol, status,
  farmer_id, trader_id, escrow_public_key, escrow_secret_key, issuer_public_key, issuer_secret_key,
  total_invested, delivery_date, stellar_asset_tx_id, soroban_campaign_contract_id, soroban_factory_tx_hash,
  app_trace_id, created_at, deleted_at
)
SELECT 
  id, commodity, quantity, quantity_unit, total_value, token_count, token_symbol, status,
  farmer_id, trader_id, escrow_public_key, escrow_secret_key, issuer_public_key, issuer_secret_key,
  total_invested, delivery_date, stellar_asset_tx_id, soroban_campaign_contract_id, soroban_factory_tx_hash,
  app_trace_id, created_at, NULL
FROM trade_deals_archive
WHERE id = 'TARGET-DEAL-UUID';

-- Re-insert investments from archive
INSERT INTO investments (
  id, trade_deal_id, investor_id, token_amount, amount_usd, stellar_tx_id, compliance_data, status, created_at, deleted_at
)
SELECT 
  id, trade_deal_id, investor_id, token_amount, amount_usd, stellar_tx_id, compliance_data, status, created_at, NULL
FROM investments_archive
WHERE trade_deal_id = 'TARGET-DEAL-UUID';

-- Re-insert shipment milestones from archive
INSERT INTO shipment_milestones (
  id, trade_deal_id, milestone, recorded_by, notes, stellar_tx_id, memo_text, latitude, longitude, recorded_at, deleted_at
)
SELECT 
  id, trade_deal_id, milestone, recorded_by, notes, stellar_tx_id, memo_text, latitude, longitude, recorded_at, NULL
FROM shipment_milestones_archive
WHERE trade_deal_id = 'TARGET-DEAL-UUID';

COMMIT;
```

---

## 5. Post-Rollback Verification

1. Verify deal visibility in standard queries:
   ```sql
   SELECT id, status, deleted_at FROM trade_deals WHERE id = 'TARGET-DEAL-UUID';
   ```
2. Re-run unit tests:
   ```bash
   npm --prefix backend run test -- archival.service.spec.ts
   ```
