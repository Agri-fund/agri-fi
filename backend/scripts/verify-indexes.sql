-- Script to verify that indexes are created and being used
-- Run this after applying migration 1700000008

-- 1. Check that all indexes exist
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('investments', 'shipment_milestones', 'payment_distributions')
    AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- 2. Verify investment availability query uses composite index
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM investments 
WHERE trade_deal_id = '00000000-0000-0000-0000-000000000000'::uuid 
    AND status = 'confirmed';

-- 3. Verify investor dashboard query uses investor_id index  
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM investments 
WHERE investor_id = '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY created_at DESC;

-- 4. Verify milestone queries use trade_deal_id index
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM shipment_milestones 
WHERE trade_deal_id = '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY recorded_at ASC;

-- 5. Verify payment distribution queries use trade_deal_id index
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM payment_distributions 
WHERE trade_deal_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- Expected output should show "Index Scan" or "Index Only Scan" instead of "Seq Scan"