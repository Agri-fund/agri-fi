# Operations Runbook: Escrow Release Failure Handling, DLQ Replay & Reconciliation

This runbook guides on-call engineers through diagnosing, triaging, and recovering from escrow processing incidents, dead-letter queue (DLQ) message buildup, and state drift between the PostgreSQL database and the Stellar/Soroban blockchain.

---

## Quick Reference

| Attribute | Details |
|---|---|
| **Owning Team** | Backend (`team: backend`) |
| **Primary On-Call** | `backend-oncall` |
| **PagerDuty Escalation** | Critical alerts page on-call immediately |
| **Critical Metrics** | `rabbitmq_queue_messages{queue="escrow.process"}`<br>`rabbitmq_queue_messages{queue="escrow.dlq"}`<br>`escrow_stellar_tx_failures_total` |
| **Key Scripts** | `backend/scripts/retry-dlq.ts`<br>`backend/scripts/reconcile-onchain-db.ts` |

---

## Table of Contents

1. [Escrow Architecture & Pipeline](#1-escrow-architecture--pipeline)
2. [Symptoms-by-Metric Matrix](#2-symptoms-by-metric-matrix)
   - [EscrowQueueDepthHigh / EscrowQueueDepthCritical](#escrowqueuedepthhigh--escrowqueuedepthcritical)
   - [DLQGrowing / DLQNotEmpty](#dlqgrowing--dlqnotempty)
   - [EscrowConsumerLag](#escrowconsumerlag)
   - [StellarTxFailureRate](#stellartxfailurerate)
   - [OutboxStalledEvents](#outboxstalledevents)
3. [Safe DLQ Replay Procedures](#3-safe-dlq-replay-procedures)
4. [Idempotency & Double-Payout Prevention](#4-idempotency--double-payout-prevention)
5. [On-Chain vs Database Reconciliation](#5-on-chain-vs-database-reconciliation)
6. [Verification Commands & Health Checks](#6-verification-commands--health-checks)
7. [What NOT to Do (Strict Guardrails)](#7-what-not-to-do-strict-guardrails)

---

## 1. Escrow Architecture & Pipeline

```
[Investment Confirmed]
        │
        ▼
[Transactional Outbox Table]
        │ (Relay worker)
        ▼
[RabbitMQ: agric_onchain_escrow_queue] (escrow.process)
        │
        ▼
[EscrowConsumer (NestJS Worker)]
   ├── 1. Acquire DB lock & check idempotency flag
   ├── 2. Invoke Soroban Escrow Contract / Stellar Horizon
   └── 3. Update DB status to 'released'
        │
   ┌────┴────────────────────────┐
 (Success)                     (Failure)
   │                             │ (Retries exhausted / Fatal)
   ▼                             ▼
[Ack Message]             [Dead-Letter Queue: escrow.dlq]
```

---

## 2. Symptoms-by-Metric Matrix

### EscrowQueueDepthHigh / EscrowQueueDepthCritical

- **Metric**: `rabbitmq_queue_messages{queue="escrow.process"}`
  - High: `> 500` for 5m (Warning)
  - Critical: `> 2000` for 2m (Critical, PagerDuty)
- **Impact**: Escrow releases and milestone token deliveries are severely delayed.
- **Root Causes**:
  - Escrow consumer service is crashed, hung, or throttled.
  - Stellar network surge or Horizon rate-limiting (`429 Too Many Requests`).
  - Database row lock contention on `investments` or `trade_deals` tables.
- **Immediate Triage**:
  1. Check consumer container health:
     ```bash
     docker compose ps backend
     docker compose logs --tail=100 -f backend
     ```
  2. Check RabbitMQ active consumers count:
     ```bash
     docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers | grep escrow
     ```
  3. If consumer count is 0, restart consumer pods or scale deployment:
     ```bash
     kubectl scale deployment agri-fi-backend-consumer --replicas=4
     ```

---

### DLQGrowing / DLQNotEmpty

- **Metric**:
  - `DLQGrowing`: `increase(rabbitmq_queue_messages{queue="escrow.dlq"}[15m]) > 0` (Warning)
  - `DLQNotEmpty`: `rabbitmq_queue_messages{queue="escrow.dlq"} > 0` for > 1h (Critical, PagerDuty)
- **Impact**: Failed payout transactions are stranded; investors or farmers have not received funds.
- **Root Causes**:
  - Stellar account balance for platform distributor is insufficient to pay transaction fees.
  - Invalid destination address or missing trustline on recipient account.
  - Contract state rejection (e.g. `OperationInProgress` flag already set, deadline passed).
- **Immediate Triage**:
  1. Inspect messages in DLQ using the inspection peek mode (non-destructive):
     ```bash
     cd backend
     npx ts-node scripts/retry-dlq.ts escrow --peek
     ```
  2. Check error headers and failure reasons.
  3. Follow [Section 3: Safe DLQ Replay Procedures](#3-safe-dlq-replay-procedures).

---

### EscrowConsumerLag

- **Metric**: `rabbitmq_queue_consumers{queue="escrow.process"} == 0` for 10m (Warning)
- **Impact**: No worker is picking up escrow messages; queue builds up continuously.
- **Root Causes**:
  - Worker process exited due to unhandled promise rejection or OOM.
  - AMQP connection lost or authentication token expired.
- **Immediate Triage**:
  1. Check consumer process status:
     ```bash
     kubectl get pods -l app=agri-fi-backend-consumer
     kubectl describe pod -l app=agri-fi-backend-consumer
     ```
  2. Restart the consumer deployment if pods are in `CrashLoopBackOff`.

---

### StellarTxFailureRate

- **Metric**: `(rate(escrow_stellar_tx_failures_total[5m]) / rate(escrow_stellar_tx_total[5m])) * 100 > 5` for 5m (Critical, PagerDuty)
- **Impact**: > 5% of blockchain transactions are reverting or timing out.
- **Root Causes**:
  - Stellar Horizon node out of sync or unreachable.
  - Base fee surge on Stellar network exceeding the hardcoded max fee.
  - Account sequence number race condition in high-concurrency releases.
- **Immediate Triage**:
  1. Check Horizon node status:
     ```bash
     curl -s https://horizon-testnet.stellar.org/fee_stats | jq .
     ```
  2. Check platform distributor account sequence:
     ```bash
     curl -s https://horizon-testnet.stellar.org/accounts/<STELLAR_PLATFORM_PUBLIC_KEY> | jq .sequence
     ```

---

### OutboxStalledEvents

- **Metric**: `outbox_pending_count > 50` for 10m (Warning)
- **Impact**: Database changes are not being published to RabbitMQ.
- **Root Causes**:
  - Outbox poller loop crashed or database connection pool is exhausted.
- **Immediate Triage**:
  1. Query pending outbox entries in database:
     ```sql
     SELECT id, event_type, retry_count, created_at, last_error 
     FROM transactional_outbox 
     WHERE status = 'pending' 
     ORDER BY created_at ASC 
     LIMIT 10;
     ```
  2. Check database connection pool health (see [db-pool runbook](https://runbooks.internal/agri-fi/db-pool)).

---

## 3. Safe DLQ Replay Procedures

> [!CAUTION]
> **NEVER blindly requeue messages from the DLQ without first inspecting payloads and fixing the underlying failure condition!** Requeueing without fixing causes crash loops and risks rate limit bans.

### Step 1: Inspect Pending DLQ Messages (Peek Mode)

Run the CLI tool with `--peek`. This reads messages from `agric_onchain_escrow_queue.dlq` without consuming or acknowledging them:

```bash
cd backend
npx ts-node scripts/retry-dlq.ts escrow --peek
```

Example Output:
```
agric_onchain_escrow_queue.dlq: 3 message(s) pending
[1] peek: {"investmentId":"8f3b4...","dealId":"d-102","action":"release","error":"tx_insufficient_balance"}
[2] peek: {"investmentId":"9c2a1...","dealId":"d-103","action":"release","error":"tx_insufficient_balance"}
[3] peek: {"investmentId":"1b4f9...","dealId":"d-104","action":"release","error":"tx_bad_seq"}
```

### Step 2: Remediate the Root Cause

- If `tx_insufficient_balance`: Fund the platform distribution wallet with XLM / USDC.
- If `tx_bad_seq`: Wait 30 seconds for pending mempool transactions to clear or reset the account sequence cache in Redis.
- If `op_no_trust`: Contact user/investor to establish the required asset trustline on Stellar.

### Step 3: Canary Replay (Limit Batch)

Replay a small test batch (e.g. 1 to 5 messages) and monitor the consumer logs:

```bash
npx ts-node scripts/retry-dlq.ts escrow --limit=1
```

Monitor consumer execution:
```bash
docker compose logs -f --tail=50 backend | grep -i "escrow"
```

Verify that:
1. The message was consumed from `agric_onchain_escrow_queue`.
2. The transaction succeeded on Stellar (check transaction hash).
3. The database record status changed from `failed` / `releasing` to `released`.
4. The message did **not** re-enter the DLQ.

### Step 4: Replay Remaining Messages

Once the canary succeeds:

```bash
npx ts-node scripts/retry-dlq.ts escrow --limit=50
```

Repeat until the DLQ is clear. Verify `rabbitmq_queue_messages{queue="escrow.dlq"} == 0`.

---

## 4. Idempotency & Double-Payout Prevention

Agri-Fi employs four strict defensive layers to guarantee that no deal or milestone can ever be released twice:

1. **Pessimistic Database Lock**:
   When `EscrowConsumer` processes an escrow release, it locks the deal record using `SELECT ... FOR UPDATE`. If `deal.status == 'released'` or `investment.status == 'released'`, processing aborts immediately.
2. **Contract-Level State Flags**:
   The Soroban escrow contract checks `env.storage().instance().get(&DataKey::Released)`. If `true`, the contract reverts with `Error::AlreadyReleased`.
3. **Operational Guard Flag**:
   Contracts set `DataKey::OperationInProgress = true` during execution. Concurrent invocations revert with `Error::OperationInProgress`.
4. **Stellar Claimable Balance Deduplication**:
   If release payouts use Stellar Claimable Balances, claimant operations are single-use. Re-submitting the same claim ID returns `op_does_not_exist` or `op_already_claimed`.

---

## 5. On-Chain vs Database Reconciliation

If network partitions or database timeouts occur during release execution, a discrepancy may exist where funds were transferred on-chain but the database was not updated (or vice-versa).

### Running the Reconciliation Tool

Trigger the automated reconciliation script:

```bash
cd backend
npx ts-node scripts/reconcile-onchain-db.ts
```

### Understanding Reconciliation Output

The tool compares DB `amount_usd` against on-chain stroops (7 decimals):

```json
[
  {
    "id": "67a91b2c-...",
    "dbAmount": "100.5000000",
    "stroops": 1005000000,
    "recheckedAmount": "100.5000000",
    "match": true
  },
  {
    "id": "99b33a1f-...",
    "dbAmount": "500.0000000",
    "stroops": 490000000,
    "recheckedAmount": "49.0000000",
    "match": false
  }
]
```

### Resolving a Mismatch (`match: false`):

1. **Query Horizon for the Transaction Hash**:
   Look up `transaction_hash` in `transaction_logs` or query the Soroban contract ID's historical events on Stellar Expert (`https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>`).
2. **Verify Actual Amount Transferred**:
   Confirm whether the contract emitted the `settled` event with the full amount.
3. **Safe Database Correction**:
   If the on-chain transfer succeeded, update the database record via administrative script with an audit log trail.
   If the on-chain transfer failed, check if funds remain in the escrow contract and re-initiate release.

---

## 6. Verification Commands & Health Checks

### Check Queue Depths & Consumer Counts

```bash
# Check queue depth via RabbitMQ HTTP API
curl -s -u guest:guest http://localhost:15672/api/queues/%2F/agric_onchain_escrow_queue | jq '{name, messages, consumers}'

# Check DLQ status
curl -s -u guest:guest http://localhost:15672/api/queues/%2F/agric_onchain_escrow_queue.dlq | jq '{name, messages}'
```

### Check Database Stuck Investments

```sql
SELECT id, trade_deal_id, investor_id, amount_usd, status, updated_at
FROM investments
WHERE status IN ('pending', 'processing')
  AND updated_at < NOW() - INTERVAL '15 minutes';
```

### Check Stellar Escrow Account Status

```bash
curl -s "https://horizon-testnet.stellar.org/accounts/<ESCROW_ACCOUNT_ID>" | jq '{id, balances}'
```

---

## 7. What NOT to Do (Strict Guardrails)

- ❌ **DO NOT purge `escrow.dlq` using the RabbitMQ Management UI.** Purging permanently destroys transaction records, making reconciliation and user refund recovery nearly impossible.
- ❌ **DO NOT manually set `status = 'released'` in PostgreSQL** without verifying the transaction hash on the Stellar ledger explorer.
- ❌ **DO NOT run DLQ replay in an infinite loop or without `--limit`** if Stellar Horizon is returning 5xx or 429 status codes.
- ❌ **DO NOT restart PostgreSQL** while large escrow release transactions are actively executing in the worker pool.
- ❌ **DO NOT bypass `OperationInProgress` locks** by modifying contract WASM storage directly without multi-sig approval.
