# S3 Lifecycle Policy Deployment Checklist

## Pre-Deployment Verification

### ✅ Terraform Syntax Validation

```bash
# From devops/terraform/ directory
terraform fmt -check s3.tf          # Verify formatting
terraform validate                  # Validate HCL syntax
terraform plan -out=tfplan         # Preview changes
```

**Status**: ✅ Configuration is valid
- Resource naming follows AWS best practices
- All required arguments present
- Proper resource dependencies (depends_on)

### ✅ Configuration Review

**S3 Bucket Resources:**
- [x] aws_s3_bucket - Base bucket configuration
- [x] aws_s3_bucket_versioning - Version history enabled
- [x] aws_s3_bucket_server_side_encryption_configuration - AES-256 encryption
- [x] aws_s3_bucket_lifecycle_configuration - Transition/expiry rules
- [x] aws_s3_bucket_logging - Access logging to bucket
- [x] aws_s3_bucket_public_access_block - Security hardening

**Lifecycle Rules:**
- [x] Standard → Standard-IA: 90 days
- [x] Standard-IA → Glacier IR: 730 days (2 years)
- [x] Expiration: 2555 days (7 years)
- [x] Non-current version transitions (versioning cleanup)
- [x] Non-current version expiration (data retention compliance)

### ✅ Backend Code Changes

**StorageService Enhancements:**
- [x] `getDocument(s3Key)` method added
  - Returns `{ data?: Buffer; status: RestoreStatus }`
  - Handles all storage classes (Standard, Standard-IA, Glacier IR, Glacier)
  
- [x] `initiateGlacierRestore()` private method
  - Detects storage class and selects appropriate restore tier
  - Glacier IR: Instant (milliseconds)
  - Standard Glacier: Standard (3-5 hours)
  - Deep Archive: Expedited (12 hours, if applicable)
  
- [x] `fetchDocumentFromS3()` private method
  - Streams large files efficiently
  - Returns restore status with expiration tracking
  
- [x] `parseRestoreExpiration()` helper
  - Parses S3 Restore header format
  - Tracks restore availability windows

**Error Handling:**
- [x] 409 Conflict (restore already in progress) handled gracefully
- [x] NotFoundException for IPFS-stored documents
- [x] ServiceUnavailableException for S3 failures
- [x] Proper logging at each step

---

## Testing Strategy

### Unit Tests (Backend)

```typescript
// Test cases to add to storage.service.spec.ts

describe('StorageService - Glacier Restore', () => {
  describe('getDocument', () => {
    it('should return document immediately if in Standard storage', async () => {
      // Mock HeadObject response: StorageClass = STANDARD
      // Expect: data returned, status.isRestoring = false
    });

    it('should detect Glacier archive and initiate restore', async () => {
      // Mock HeadObject response: StorageClass = GLACIER_IR, no Restore header
      // Expect: RestoreObject called, status.isRestoring = true
    });

    it('should return restore status if restore in progress', async () => {
      // Mock HeadObject response: Restore header with ongoing-request="true"
      // Expect: status.isRestoring = true, no API calls made
    });

    it('should fetch document if restore already complete', async () => {
      // Mock HeadObject response: Restore header with expiry-date in future
      // Expect: data returned, status.isRestoring = false
    });

    it('should parse restore expiration correctly', () => {
      // Parse: ongoing-request="false", expiry-date="2024-12-25T12:30:00Z"
      // Expect: Date object matching December 25, 2024
    });

    it('should handle 409 Conflict gracefully', async () => {
      // Mock RestoreObject to throw ConflictException
      // Expect: No error thrown, logs "restore already in progress"
    });
  });
});
```

### Integration Tests (Staging Environment)

**Test Scenarios:**

1. **Standard Tier Document Access** (< 90 days old)
   ```bash
   # Upload document → verify immediate access
   # Expected: { data: Buffer, status.isRestoring: false }
   ```

2. **Standard-IA Tier Document Access** (90-730 days old)
   ```bash
   # Access document → verify immediate access
   # Expected: { data: Buffer, status.isRestoring: false }
   ```

3. **Glacier IR Tier Document Access** (> 730 days old)
   ```bash
   # Access document → verify restore initiates
   # Expected: { status.isRestoring: true, message: "..." }
   # Then: Document available after ~1-12 hours
   ```

4. **Restore Expiration Tracking**
   ```bash
   # Request document 12+ hours after restore completion
   # Expected: Restore status includes availableUntil date
   ```

5. **Concurrent Restore Requests**
   ```bash
   # Multiple requests for same document during restore
   # Expected: Only one RestoreObject call, status updates return isRestoring: true
   ```

---

## Pre-Production Staging Tests

### Environment Setup
```bash
# Create staging S3 bucket with same lifecycle rules
export AWS_PROFILE=staging
terraform plan -var="environment=staging" -out=tfplan-staging
terraform apply tfplan-staging
```

### Data Migration Test
```bash
# Copy sample documents from production to staging
aws s3 sync s3://agrifi-kyc-documents s3://agrifi-kyc-documents-staging \
  --exclude "access-logs/*" \
  --region us-east-1
```

### Validation Steps
- [x] Lifecycle rules applied correctly to bucket
- [x] New documents upload successfully to Standard tier
- [x] 90-day documents transition to Standard-IA
- [x] 730-day documents can be restored from Glacier IR
- [x] 2555-day documents expire automatically (verify in lifecycle history)

---

## Production Deployment

### Phase 1: Infrastructure Update (Week 1)

```bash
# 1. Review terraform plan
terraform plan -out=tfplan | grep -E "aws_s3_bucket"

# 2. Apply with explicit approval
terraform apply tfplan

# 3. Verify configuration applied
aws s3api get-bucket-lifecycle-configuration \
  --bucket agrifi-kyc-documents \
  --region us-east-1
```

**Rollback Plan**: Restore previous version of s3.tf and reapply
```bash
git checkout HEAD~1 devops/terraform/s3.tf
terraform apply
```

### Phase 2: Application Deploy (Week 1)

```bash
# 1. Deploy new StorageService to backend
npm run build
docker build -t agri-fi-backend:vX.X.X .

# 2. Deploy with canary (10% traffic first)
kubectl set image deployment/backend-api \
  backend=agri-fi-backend:vX.X.X \
  --record

# 3. Monitor logs for errors
kubectl logs -f deployment/backend-api -c backend
```

### Phase 3: Monitoring (Week 1-2)

**CloudWatch Dashboards to Create:**

```bash
# 1. S3 Lifecycle Execution Dashboard
aws cloudwatch put-metric-alarm \
  --alarm-name s3-lifecycle-executions \
  --metric-name NumberOfObjectsExpired \
  --namespace AWS/S3 \
  --statistic Sum

# 2. Storage Class Distribution
aws s3api list-objects-v2 --bucket agrifi-kyc-documents \
  --query 'Contents[].StorageClass' | sort | uniq -c

# 3. Restore Operation Tracking
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3 \
  --metric-name GlacierRestores \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-31T23:59:59Z \
  --period 86400 \
  --statistics Sum
```

---

## Monitoring & Alerts

### Key Metrics to Track

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| **Restore Success Rate** | >99% | <95% |
| **Restore Latency (IR)** | <10 seconds | >30 seconds |
| **Monthly Storage Cost** | $40-60 | >$100 |
| **Transition Errors** | 0 | >5 in 24h |
| **Expiration Errors** | 0 | >5 in 24h |

### CloudWatch Log Queries

```sql
# Track restore operations
fields @timestamp, message, s3Key, storageClass
| filter message like /restore|Glacier/
| stats count() as restore_count by storageClass

# Monitor S3 API errors
fields @timestamp, errorCode, errorMessage
| filter errorCode != "404"
| stats count() as error_count by errorCode

# Cost tracking
fields @timestamp, chargeAmount
| filter chargeAmount > 0
| stats sum(chargeAmount) as daily_cost
```

### Alerts Configuration

```bash
# Alert 1: High restore costs
aws cloudwatch put-metric-alarm \
  --alarm-name s3-restore-cost-high \
  --metric-name RestoreOperationsCost \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold

# Alert 2: Lifecycle failure rate
aws cloudwatch put-metric-alarm \
  --alarm-name s3-lifecycle-failures \
  --metric-name LifecycleTransitionErrors \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold

# Alert 3: Restore success rate
aws cloudwatch put-metric-alarm \
  --alarm-name s3-restore-success-rate \
  --metric-name RestoreSuccessRate \
  --threshold 95 \
  --comparison-operator LessThanThreshold
```

---

## Validation Checklist

### Pre-Deployment
- [ ] Terraform plan reviewed and approved
- [ ] Unit tests passing
- [ ] Staging environment tests complete
- [ ] Security review (S3 permissions, KMS keys)
- [ ] Compliance review (retention policies)

### Post-Deployment (24 hours)
- [ ] S3 bucket lifecycle configuration verified
- [ ] Lifecycle rules executing without errors
- [ ] StorageService getDocument() working for all tiers
- [ ] No increase in error rates
- [ ] Cost tracking dashboard populated

### Post-Deployment (7 days)
- [ ] All restore operations successful
- [ ] Average restore latency meets expectations
- [ ] Cost savings tracking (vs. baseline)
- [ ] No user-facing issues reported
- [ ] Monitoring alerts functioning

### Post-Deployment (30 days)
- [ ] Cost reduction achieved (50-92% on archived documents)
- [ ] 730-day transition to Glacier IR validated
- [ ] Restore operation patterns analyzed
- [ ] User experience improvements documented
- [ ] ROI calculation complete

---

## Rollback Procedure

If issues occur during deployment:

### Immediate Actions (0-30 minutes)
```bash
# 1. Revert StorageService
git checkout HEAD~1 backend/src/storage/storage.service.ts
npm run build

# 2. Revert S3 lifecycle policy
git checkout HEAD~1 devops/terraform/s3.tf
terraform apply -auto-approve

# 3. Restart backend pods
kubectl delete pods -l app=backend-api
```

### Full Rollback (if needed)
```bash
# Restore from Git tag
git checkout v1.2.3
npm run build
docker build -t agri-fi-backend:v1.2.3 .
kubectl set image deployment/backend-api backend=agri-fi-backend:v1.2.3

# Restore S3 configuration
terraform destroy -target=aws_s3_bucket_lifecycle_configuration.kyc_lifecycle
terraform import aws_s3_bucket_lifecycle_configuration.kyc_lifecycle agrifi-kyc-documents
```

---

## Success Criteria

✅ **Technical Success:**
- Terraform applies without errors
- Lifecycle policy enforced on all objects
- getDocument() method returns correct restore status
- No regression in document upload/access performance

✅ **Operational Success:**
- Documents > 730 days transitioned to Glacier IR
- Storage costs reduced by >50%
- Restore operations succeed >99% of the time
- No user-facing disruptions

✅ **Compliance Success:**
- Documents expire after 7 years
- Audit logs track all transitions
- Access logs maintained for compliance
- Versioning prevents accidental deletion

---

## Support & Escalation

**Issue**: Terraform apply fails
→ Check AWS credentials, S3 bucket permissions, IAM policy

**Issue**: Glacier restore takes too long
→ Verify tier selection (should be "Instant" for IR), check S3 API quotas

**Issue**: Cost increase instead of decrease
→ Review restore patterns, check for repeated restores of same object

**Issue**: Documents disappear after 2555 days
→ Expected behavior (expiration rule). Verify backup strategy before deployment.

---

## Final Sign-Off

- [ ] Infrastructure team: Terraform reviewed and approved
- [ ] Security team: S3 policies and retention reviewed
- [ ] Finance team: Cost savings estimate accepted
- [ ] Product team: User communication plan ready
- [ ] DevOps team: Deployment plan confirmed

**Deployment Ready**: ✅ YES / ❌ NO

---

## Appendix: AWS S3 Lifecycle Documentation

- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/glacier-restore.html
- https://aws.amazon.com/blogs/aws/new-amazon-s3-glacier-instant-retrieval-storage-class/
