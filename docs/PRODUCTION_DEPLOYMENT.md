# Agri-Fi Production Deployment Runbook

This runbook documents the standard operating procedure for deploying releases to the Agri-Fi production environment. It covers pre-flight verification, Soroban smart contract deployment, mainnet key management, blue-green deployment execution, smoke testing, and emergency rollback procedures.

---

## 1. Pre-Flight Checklist

Before initiating a production release:

1. **Tag Verification**:
   - Verify that the release tag adheres to semantic versioning (`v*.*.*`).
   - Ensure all commit checks on `main` passed (unit tests, E2E tests, contract tests, and security audits).
2. **Environment Approval Gate**:
   - Confirm that release approvals have been granted in the GitHub Repository Settings -> Environments -> `production`.
3. **Database Readiness**:
   - Verify Postgres primary-replica replication lag is under 1 second:
     ```sql
     SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;
     ```
   - Check that all pending TypeORM migrations have been reviewed for backward compatibility (non-blocking DDL).
4. **Secret Configuration**:
   - Verify the following GitHub Secrets are configured in the `production` environment:
     - `KUBE_CONFIG_PRODUCTION`: Base64-encoded production kubeconfig.
     - `SOROBAN_FACTORY_CONTRACT_ID`: Mainnet Soroban ProjectFactory contract address.
     - `SOROBAN_SETTLEMENT_CONTRACT_ID`: Mainnet Soroban MarketplaceSettlement contract address.
     - `SOROBAN_DISTRIBUTOR_CONTRACT_ID`: Mainnet Soroban RevenueDistributor contract address.
     - Note: The CD pipeline will automatically validate that no placeholder (`CAAA...`) values are present.

---

## 2. Soroban Smart Contract Mainnet Deployment

When new smart contracts or contract upgrades are required on Stellar Mainnet:

### 2.1 Contract Compilation
Ensure the contracts are compiled with release size optimizations (`opt-level = "z"`, `panic = "abort"`):
```bash
cd blockchain
cargo build --release --target wasm32-unknown-unknown
```

### 2.2 Upload WASM & Deploy Contract Instances
Using the platform deployer key stored in AWS Secrets Manager:
```bash
# Retrieve platform deployer secret
PLATFORM_SECRET=$(aws secretsmanager get-secret-value --secret-id prod/stellar/platform-secret --query SecretString --output text)

# Deploy instances via Stellar CLI or seed deployment script
STELLAR_NETWORK=mainnet \
SOROBAN_RPC_URL=https://soroban-rpc.mainnet.stellar.org \
STELLAR_PLATFORM_SECRET=$PLATFORM_SECRET \
npm run deploy:contracts
```

### 2.3 Record Real Contract Addresses
Store the newly deployed contract IDs in:
1. GitHub Repository Secrets (`production` environment):
   - `SOROBAN_FACTORY_CONTRACT_ID`
   - `SOROBAN_SETTLEMENT_CONTRACT_ID`
   - `SOROBAN_DISTRIBUTOR_CONTRACT_ID`
2. AWS Secrets Manager: `prod/agri-fi/contracts`

---

## 3. Mainnet Key Rotation Procedure

To rotate signing keys (e.g. SEP-10 signing key, escrow signing authority, platform hot wallet):

1. **Generate New Keypair in Vault / AWS KMS**:
   ```bash
   stellar keys generate prod-sep10-v2 --network pubnet
   ```
2. **Authorise New Signer On-Chain**:
   Add the new public key as an authorized signer on the multi-sig account before removing the old key:
   ```bash
   stellar account set-options --signers "KEY_V2:1" --thresholds "2:2:2"
   ```
3. **Update Application Secrets in AWS Secrets Manager**:
   ```bash
   aws secretsmanager update-secret --secret-id prod/stellar/sep10-signing-secret --secret-string "$NEW_SECRET"
   ```
4. **Gradual Drain / De-registration**:
   Allow a 24-hour overlap window to ensure any in-flight SEP-10 authentication transactions complete before removing the retired key from on-chain signers.

---

## 4. Blue-Green Deployment Execution

Production deployments are automated via GitHub Actions workflow `.github/workflows/cd-production.yml`.

### Automated Workflow Steps:
1. **Trigger**:
   Pushed tag `vX.Y.Z` triggers the `CD — Production` workflow.
2. **Approval Gate**:
   GitHub Environments halts execution at `production` until two designated maintainers approve the deployment.
3. **Container Build**:
   Multi-stage images for `backend` and `frontend` are built and pushed to GHCR.
4. **Automated Migration**:
   A Kubernetes Job `agri-fi-migrate-prod-*` executes database migrations against the production database.
5. **Inactive Slot Deployment**:
   The workflow discovers the inactive slot (`blue` or `green`) and deploys the new images with 3 replicas.
6. **Internal Smoke Tests**:
   Before switching live traffic, a temporary internal probe tests the inactive slot:
   - `GET /health` -> 200 OK
   - `GET /health/ready` -> 200 OK
   - Critical API endpoint response times within SLA (< 200ms).
7. **Traffic Switch**:
   The `agri-fi-backend` Service selector is patched to route 100% of traffic to the newly verified slot.
8. **5-Minute Hold Window**:
   The previously active slot is maintained with warm replicas for 300 seconds to allow instant rollback if anomalies are detected.
9. **Old Slot Scale Down**:
   After 5 minutes without errors, the previous slot is scaled to 0 replicas.

---

## 5. Smoke Testing & Verification

Immediately following the traffic switch, run the post-deployment smoke test suite:

```bash
# Verify live backend health
curl -sSf https://api.agri-fi.com/health | jq .

# Verify SEP-10 Web Auth challenge generation
curl -sSf -X POST https://api.agri-fi.com/v1/auth/sep10/challenge \
  -H "Content-Type: application/json" \
  -d '{"publicKey": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"}' | jq .

# Check Redis SEP-10 challenge persistence
# Challenge key must exist in Redis with TTL ~ 300s
redis-cli -u $REDIS_PROD_URL TTL "sep10:challenge:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"

# Verify Horizon & Soroban RPC connectivity
curl -sSf https://api.agri-fi.com/v1/stellar/network-status | jq .
```

---

## 6. Emergency Rollback Procedure

If critical errors, increased 5xx rates, or contract failures occur post-deployment:

### 6.1 Automated Rollback
If the deployment job fails before traffic switch completes, the `rollback` job in `.github/workflows/cd-production.yml` automatically scales up the previous slot and points the service selector back.

### 6.2 Instant Manual Slot Reversion (< 30 Seconds)
If rollback is needed during or immediately after the deployment:

```bash
# 1. Identify previous slot (e.g. if current is green, revert to blue)
CURRENT_SLOT=$(kubectl -n default get svc agri-fi-backend -o jsonpath='{.spec.selector.slot}')
PREV_SLOT=$([ "$CURRENT_SLOT" = "green" ] && echo "blue" || echo "green")

echo "Reverting from $CURRENT_SLOT to $PREV_SLOT..."

# 2. Scale previous slot back up to 3 replicas
kubectl -n default scale deployment/agri-fi-backend-$PREV_SLOT --replicas=3

# 3. Wait for readiness
kubectl -n default rollout status deployment/agri-fi-backend-$PREV_SLOT --timeout=60s

# 4. Instant traffic flip
kubectl -n default patch svc agri-fi-backend -p "{\"spec\":{\"selector\":{\"slot\":\"$PREV_SLOT\"}}}"

# 5. Scale down the faulty slot
kubectl -n default scale deployment/agri-fi-backend-$CURRENT_SLOT --replicas=0

echo "Rollback to $PREV_SLOT completed successfully."
```

### 6.3 Database Migration Rollback (if necessary)
If the failed release applied schema migrations that must be undone:
```bash
kubectl -n default run rollback-job --rm -i --restart=Never \
  --image=ghcr.io/agri-fund/agri-fi/backend:previous-tag -- \
  npm run migration:revert
```
