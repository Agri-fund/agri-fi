# ADR-004: Queue Encryption via AES-GCM Envelope Encryption

* **Status:** Accepted
* **Date:** 2026-09-25
* **Authors:** Agri-Fi Core Architecture Team

---

## 1. Context and Problem Statement

RabbitMQ message queues transmit payloads containing sensitive data (e.g. escrow private key seeds, PII, payment metadata). If RabbitMQ management UI or disk queues are compromised, unencrypted message bodies expose critical secrets.

---

## 2. Decision Outcome

We implemented **AES-256-GCM Envelope Encryption** for all queued payload data via `queue.crypto` utilities.

Key details:
1. Message payloads are encrypted using a 256-bit key (`ENCRYPTION_KEY`) with AES-256-GCM before pushing to RabbitMQ exchanges.
2. Each payload generates a unique 12-byte initialization vector (IV) and a 16-byte authentication tag (`authTag`).
3. Outbound queue messages take the structured envelope format:
   ```json
   {
     "iv": "<hex_iv>",
     "authTag": "<hex_tag>",
     "encryptedData": "<hex_ciphertext>"
   }
   ```
4. Consumer workers decrypt payloads in memory immediately before execution.

---

## 3. Consequences

### Positive Consequences
- **Zero Plaintext at Rest in Queue:** RabbitMQ storage logs and management UI exhibit zero secret exposure.
- **Tamper Protection:** AES-GCM authentication tag verification rejects altered or corrupted queue messages automatically.

### Negative Consequences / Trade-offs
- **Debugging Friction:** Inspected messages in RabbitMQ management interface cannot be read visually without running decryption tools.
- **CPU Overhead:** Small symmetric encryption/decryption overhead per queue message (negligible in Node.js crypto module).

---

## 4. Alternatives Considered

1. **Option 1: Plaintext JSON Queue Payloads**
   - *Pros:* Simple to debug and inspect in RabbitMQ web UI.
   - *Cons:* Security vulnerability exposing private key seeds and financial PII.
   - *Reason for rejection:* Direct breach of platform security policy.

2. **Option 2: TLS Transport-Only Encryption (RabbitMQ over TLS)**
   - *Pros:* Protects data in transit over the network.
   - *Cons:* Fails to protect data at rest on RabbitMQ node disks or memory dumps.
   - *Reason for rejection:* Insufficient protection for stored secrets in queue storage.
