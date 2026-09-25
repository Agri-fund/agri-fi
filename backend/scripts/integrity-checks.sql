-- integrity-checks.sql
-- Data integrity assertions run against the isolated restore instance.
-- Issue #862 — Automated database backup verification with restore testing.
--
-- Each statement should return a single row/value that confirms health.
-- Any query that returns an unexpected count causes the shell script to
-- flag the failure and alert PagerDuty.

\echo '=== AgriFi Data Integrity Checks ==='
\echo ''

-- ── 1. Core Table Existence ────────────────────────────────────────────────
\echo '--- 1. Core Table Existence ---'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'users', 'trade_deals', 'investments', 'shipment_milestones',
    'documents', 'system_audit_logs', 'notifications'
  )
ORDER BY table_name;

-- ── 2. Row Counts ─────────────────────────────────────────────────────────
\echo '--- 2. Row Counts ---'
SELECT
  (SELECT COUNT(*) FROM users)                           AS users,
  (SELECT COUNT(*) FROM trade_deals)                     AS trade_deals,
  (SELECT COUNT(*) FROM investments)                     AS investments,
  (SELECT COUNT(*) FROM shipment_milestones)             AS shipment_milestones,
  (SELECT COUNT(*) FROM documents)                       AS documents,
  (SELECT COUNT(*) FROM system_audit_logs)               AS audit_logs;

-- ── 3. Referential Integrity ──────────────────────────────────────────────
\echo '--- 3. Referential Integrity ---'

-- Investments referencing non-existent trade deals
SELECT 'orphan_investments' AS check_name,
       COUNT(*) AS violation_count
FROM investments i
LEFT JOIN trade_deals t ON i.trade_deal_id = t.id
WHERE t.id IS NULL
HAVING COUNT(*) > 0;

-- Shipment milestones referencing non-existent trade deals
SELECT 'orphan_milestones' AS check_name,
       COUNT(*) AS violation_count
FROM shipment_milestones m
LEFT JOIN trade_deals t ON m.trade_deal_id = t.id
WHERE t.id IS NULL
HAVING COUNT(*) > 0;

-- Documents referencing non-existent trade deals
SELECT 'orphan_documents' AS check_name,
       COUNT(*) AS violation_count
FROM documents d
LEFT JOIN trade_deals t ON d.trade_deal_id = t.id
WHERE t.id IS NULL
HAVING COUNT(*) > 0;

-- Notifications referencing non-existent users
SELECT 'orphan_notifications' AS check_name,
       COUNT(*) AS violation_count
FROM notifications n
LEFT JOIN users u ON n.user_id = u.id
WHERE u.id IS NULL
HAVING COUNT(*) > 0;

-- ── 4. Business Rule Assertions ───────────────────────────────────────────
\echo '--- 4. Business Rule Assertions ---'

-- Total invested must not exceed total deal value
SELECT 'over_invested_deals' AS check_name,
       COUNT(*) AS violation_count,
       ARRAY_AGG(id) AS deal_ids
FROM trade_deals
WHERE CAST(total_invested AS NUMERIC) > CAST(total_value AS NUMERIC)
HAVING COUNT(*) > 0;

-- Token counts must be positive
SELECT 'non_positive_token_count' AS check_name,
       COUNT(*) AS violation_count
FROM trade_deals
WHERE token_count <= 0
HAVING COUNT(*) > 0;

-- Investment amounts must be positive
SELECT 'non_positive_investment_amounts' AS check_name,
       COUNT(*) AS violation_count
FROM investments
WHERE CAST(amount_usd AS NUMERIC) <= 0
HAVING COUNT(*) > 0;

-- Token amounts must be positive
SELECT 'non_positive_token_amounts' AS check_name,
       COUNT(*) AS violation_count
FROM investments
WHERE CAST(token_amount AS NUMERIC) <= 0
HAVING COUNT(*) > 0;

-- Users must have non-null email
SELECT 'null_email_users' AS check_name,
       COUNT(*) AS violation_count
FROM users
WHERE email IS NULL OR email = ''
HAVING COUNT(*) > 0;

-- Deal status must be in the valid set
SELECT 'invalid_deal_status' AS check_name,
       COUNT(*) AS violation_count,
       ARRAY_AGG(DISTINCT status) AS invalid_statuses
FROM trade_deals
WHERE status NOT IN ('draft', 'open', 'funded', 'in_transit', 'delivered', 'completed', 'failed', 'canceled', 'expired')
HAVING COUNT(*) > 0;

-- Investment status must be in the valid set
SELECT 'invalid_investment_status' AS check_name,
       COUNT(*) AS violation_count
FROM investments
WHERE status NOT IN ('pending', 'confirmed', 'failed', 'refunded')
HAVING COUNT(*) > 0;

-- ── 5. Deal Financial Consistency ─────────────────────────────────────────
\echo '--- 5. Deal Financial Consistency ---'

-- Sum of confirmed investment amounts should not exceed deal total_value
SELECT
  t.id AS deal_id,
  t.commodity,
  CAST(t.total_value AS NUMERIC)    AS total_value,
  CAST(t.total_invested AS NUMERIC) AS stored_total_invested,
  SUM(CAST(i.amount_usd AS NUMERIC)) AS calculated_invested
FROM trade_deals t
JOIN investments i ON i.trade_deal_id = t.id AND i.status = 'confirmed'
GROUP BY t.id, t.commodity, t.total_value, t.total_invested
HAVING ABS(SUM(CAST(i.amount_usd AS NUMERIC)) - CAST(t.total_invested AS NUMERIC)) > 1
ORDER BY deal_id
LIMIT 20;

-- ── 6. Index Presence ─────────────────────────────────────────────────────
\echo '--- 6. Critical Index Presence ---'
SELECT
  indexname,
  tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('trade_deals', 'investments', 'users', 'shipment_milestones')
ORDER BY tablename, indexname;

-- ── 7. No Soft-Deleted Critical Records Visible (if soft-delete enabled) ──
\echo '--- 7. Soft-Delete Integrity ---'
SELECT 'deals_with_deleted_at_but_active' AS check_name,
       COUNT(*) AS violation_count
FROM trade_deals
WHERE deleted_at IS NOT NULL
  AND status IN ('open', 'funded', 'in_transit')
HAVING COUNT(*) > 0;

-- ── Summary ────────────────────────────────────────────────────────────────
\echo ''
\echo '=== Integrity Checks Complete ==='
\echo '(Rows returned above indicate violations — empty result sets are healthy)'
