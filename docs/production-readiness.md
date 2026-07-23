# Production Readiness Checklist

This document outlines the mandatory verification steps required before deploying the Agri-fi platform to the production environment.

## 1. Database & Persistence

### 1.1 Database Replication Verification
- [ ] **Verify Replica Sync**: Ensure all read replicas are in sync with the primary instance.
  - Test: Run `SELECT now() - pg_last_xact_replay_timestamp();` on replicas to check lag.
- [ ] **Failover Test**: Perform a manual failover in the staging environment to ensure the application reconnects to the new primary automatically.
- [ ] **Backup Integrity**: Verify that automated daily snapshots are enabled and perform a test restoration to a temporary instance.

### 1.2 Database Performance
- [ ] **Index Verification**: Run `verify-indexes.sql` to ensure all critical query paths are indexed.
- [ ] **Connection Pooling**: Verify that `pgbouncer` or internal NestJS connection pooling is configured to handle expected peak loads.

## 2. Security & Encryption

### 2.1 SSL/TLS Configuration
- [ ] **Certificate Validity**: Verify that ACM (AWS Certificate Manager) certificates for `domain_name` and `*.domain_name` are issued and "In use".
- [ ] **CloudFront Integration**: Confirm the CloudFront distribution is using the correct SSL certificate and "Viewer Protocol Policy" is set to `redirect-to-https`.
- [ ] **End-to-End Encryption**: Ensure traffic between CloudFront and the Backend Load Balancer/EC2 is encrypted.

### 2.2 KMS Key Management
- [ ] **Rotation Policy**: Verify that "Automatic Key Rotation" is enabled for the Vault unseal key and application encryption keys.
- [ ] **Manual Rotation Test**: Trigger a manual rotation of a non-critical test key to verify IAM permissions and operational flow.
- [ ] **Access Control**: Audit IAM policies to ensure only the necessary service roles have `kms:Decrypt` permissions.

### 2.3 Secrets Management (Vault)
- [ ] **Auto-Unseal**: Confirm Vault instances auto-unseal using KMS after a reboot.
- [ ] **Policy Audit**: Verify `backend-app-policy` only grants `read` access to required paths.
- [ ] **Secret Injection**: Ensure production secrets (Stellar keys, DB passwords) are manually populated in Vault and not stored in `.env` files.

## 3. Stellar Blockchain Integration

### 3.1 Network Configuration
- [ ] **Network Switch**: Verify `STELLAR_NETWORK` is set to `mainnet`.
- [ ] **Horizon URL**: Confirm `STELLAR_HORIZON_URL` points to a production-grade Horizon provider (e.g., PublicNode or a self-hosted instance).

### 3.2 Liquidity & Funding
- [ ] **Platform Account**: Ensure the platform's public key is funded with sufficient XLM for transaction fees.
- [ ] **Asset Trustlines**: Verify that the platform account has established trustlines for required stablecoins (e.g., USDC).

## 4. Messaging & Infrastructure

### 4.1 RabbitMQ
- [ ] **Persistence**: Verify that all critical queues (escrow, shipments) are marked as `durable`.
- [ ] **DLQ (Dead Letter Queues)**: Confirm DLQs are configured for all consumers to catch and alert on failed jobs.

### 4.2 Monitoring & Alerting
- [ ] **Logs**: Verify structured logs are flowing to CloudWatch/ELK.
- [ ] **Alerting**: Ensure alerts are active for:
  - High Error Rate (5xx).
  - Database CPU > 80%.
  - RabbitMQ Queue Depth > 1000.
  - Stellar Transaction Failures.

## 5. Deployment Finalization
- [ ] **Terraform State**: Ensure Terraform state is locked in S3/DynamoDB.
- [ ] **CI/CD**: Verify that the production pipeline requires manual approval before deployment.
