# ADR-002: Transactional Outbox Pattern and Dead Letter Queue (DLQ)

* **Status:** Accepted
* **Date:** 2026-09-25
* **Authors:** Agri-Fi Core Architecture Team

---

## 1. Context and Problem Statement

Agri-Fi needs to mutate PostgreSQL database state (e.g., mark an investment as pending/confirmed) and publish asynchronous background tasks to RabbitMQ (e.g., Stellar asset issuance, payment submission, email notifications). 

Directly publishing messages to RabbitMQ inside an HTTP request handler within a database transaction causes dual-write inconsistencies if:
- Database commit fails after message is sent.
- RabbitMQ broker is temporarily unreachable during HTTP request processing.

---

## 2. Decision Outcome

We implemented the **Transactional Outbox Pattern** combined with a dedicated **Dead Letter Queue (DLQ)**.

Key details:
1. When business operations occur, outbox records (`OutboxEntity`) are inserted into PostgreSQL within the *same* database transaction as domain state changes.
2. A background polling worker process reads pending outbox messages, publishes them to RabbitMQ, and marks them as processed upon broker acknowledgment.
3. Messages failing worker execution after maximum retry attempts (e.g. 3 attempts with exponential back-off) are routed to a Dead Letter Queue (`dlq`) for inspection and manual/automated re-processing via `npm run queue:retry-dlq`.

---

## 3. Consequences

### Positive Consequences
- **Guaranteed At-Least-Once Delivery:** Database state change and message publication are strictly atomic.
- **Resilience to Transient Broker Outages:** Network glitches to RabbitMQ do not fail HTTP client requests.
- **Operational Safety via DLQ:** Failed messages are captured in DLQ rather than lost silently.

### Negative Consequences / Trade-offs
- **Eventual Consistency:** System processing involves minor latency (polling delay / queue processing time).
- **Storage Overhead:** Outbox table requires periodic cleanup of processed messages.

---

## 4. Alternatives Considered

1. **Option 1: Direct dual-write to DB and RabbitMQ inside controller/service**
   - *Pros:* Simpler initial implementation without outbox table.
   - *Cons:* Prone to data inconsistency on partial failure.
   - *Reason for rejection:* Unacceptable risk of lost events or orphaned queue jobs.

2. **Option 2: PostgreSQL LISTEN / NOTIFY triggers**
   - *Pros:* Real-time push notification from DB.
   - *Cons:* Connection limits and message loss if listener client crashes.
   - *Reason for rejection:* Outbox polling with worker lock provides higher durability guarantees.
