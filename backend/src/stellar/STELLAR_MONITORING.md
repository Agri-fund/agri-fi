# Stellar Platform Wallet Monitoring

## Overview

The Stellar Balance Monitor service continuously monitors the platform fee wallet to prevent transaction failures due to insufficient XLM balance. It runs every 10 minutes and provides alerts, metrics, and projections for operational visibility.

## Issue

**Issue #359**: Build platform Stellar balance monitoring worker

If the platform main gas wallet runs out of XLM, all automated operations fail. This service provides early warning.

## Features

### 1. Balance Monitoring
- Checks XLM balance every 10 minutes
- Compares against configurable threshold (default: 50 XLM)
- Prevents alert spam with 1-hour cooldown
- Auto-recovers when balance is restored

### 2. Transaction Volume Analysis
- Fetches last 100 transactions from platform account
- Calculates average fee per transaction
- Computes total fees over time span
- Analyzes transaction patterns

### 3. Fee Burn Projection
- Projects monthly XLM fee burn based on recent activity
- Estimates days until wallet is empty
- Helps with funding schedule planning
- Accounts for variable transaction volumes

### 4. Multi-Channel Alerting
- Discord webhook support (rich embeds)
- Slack webhook support (formatted messages)
- PagerDuty integration (severity-based routing)
- Generic HTTP webhook fallback
- Comprehensive metrics in all alert types

## Architecture

```
StellarMonitorService
├── checkFeePoolBalance() [Every 10 minutes]
│   ├── Load account from Horizon
│   ├── Check XLM balance
│   ├── Fetch recent transactions
│   ├── Analyze fee metrics
│   ├── Project monthly burn
│   └── Trigger alert if below threshold
├── fetchRecentTransactions()
│   └── Query last 100 transactions
├── analyzeFeeMetrics()
│   ├── Calculate average fee
│   ├── Sum total fees
│   └── Project monthly burn
└── triggerLowBalanceAlert()
    └── Send webhook alert with metrics
```

## Configuration

### Environment Variables

```bash
# Balance threshold for alerting (default: 50 XLM)
STELLAR_MONITOR_BALANCE_THRESHOLD=50

# Webhook URL for alerts (Discord, Slack, or PagerDuty)
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Existing Stellar configuration (required)
STELLAR_PLATFORM_SECRET=S...
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK=testnet
```

### Threshold Configuration

The alert threshold is configurable via environment variable:

```bash
# Alert if balance < 50 XLM (default)
STELLAR_MONITOR_BALANCE_THRESHOLD=50

# Or customize for your needs
STELLAR_MONITOR_BALANCE_THRESHOLD=100
```

Recommended thresholds:
- **Testnet**: 20-50 XLM (lower activity)
- **Mainnet**: 50-200 XLM (higher safety margin)

## Alert Examples

### Discord Format

Rich embeds with color coding and detailed fields:
- Current balance (red alert)
- Alert threshold
- Account ID (copyable)
- Average fee per transaction
- Projected monthly burn
- Estimated days until empty

### Slack Format

Formatted message with:
- Critical alert headline
- Balance and threshold comparison
- Account identifier
- Fee metrics
- Monthly burn projection
- Days until empty estimate

### PagerDuty Format

Severity-based routing with:
- Severity: CRITICAL
- Source: agric-onchain-backend
- Custom details: balance, threshold, metrics
- Auto-incident routing and escalation

## Metrics Explained

### XLM Balance
Current balance in the platform wallet. If below threshold, alert is triggered.

### Average Fee per Transaction
Calculated from recent 100 transactions. Shows typical cost per operation.

```
Avg Fee = Total Fees / Number of Transactions
```

### Projected Monthly Burn
Extrapolates current fee rate to 30 days.

```
Time Span = Newest TX Date - Oldest TX Date
Projected Monthly Burn = (Total Fees / Time Span Days) × 30
```

### Days Until Empty (Estimated)
Based on current balance and projected burn rate.

```
Days Until Empty = (Current Balance / Monthly Burn) × 30
```

**Note**: This is an estimate based on recent activity. Actual burn may vary.

## Monitoring Best Practices

### Alert Response Procedure

1. **Verify Alert**
   - Check current balance on Stellar Expert
   - Verify platform account ID matches expected

2. **Assess Urgency**
   - If < 10 XLM: IMMEDIATE funding required
   - If < 30 XLM: Fund within 1 hour
   - If < 50 XLM: Fund within 24 hours

3. **Fund Wallet**
   - Send XLM from main platform account
   - Verify transaction on Stellar
   - Monitor next check cycle

4. **Update Threshold**
   - If recurring alerts: increase threshold
   - If excess balance: consider lowering threshold
   - Document any threshold changes

### Operational Monitoring

**Daily**:
- Review alert logs
- Check projected burn rate trends
- Monitor transaction volumes

**Weekly**:
- Analyze fee patterns
- Plan funding schedule
- Review alert frequency

**Monthly**:
- Validate burn rate projections
- Adjust threshold if needed
- Archive historical metrics

## API Integration

The monitoring service is automatically initialized with the Stellar module:

```typescript
// stellar.module.ts
@Module({
  providers: [StellarService, StellarMonitorService],
  ...
})
export class StellarModule {}
```

No additional configuration needed beyond environment variables.

## Logging

All monitoring activities are logged with detailed context:

```
[INFO] Starting platform wallet health check...
[INFO] Platform wallet health metrics {
  xlmBalance: 125.5,
  thresholdXlm: 50,
  sequenceNumber: "12345",
  subentryCount: 3,
  recentTxCount: 45,
  avgFeeXlm: 0.00001,
  totalFeesXlm: 0.00045,
  projectedMonthlyBurnXlm: 0.35
}
```

Example alert log:
```
[ERROR] ALERT_WEBHOOK_URL not configured! 🚨 CRITICAL: Stellar Platform Account...
[INFO] Successfully triggered low balance webhook alert.
[WARN] Low balance alert suppressed due to cooldown. Balance is 45.5 XLM
```

## Testing

### Manual Testing

1. **Test Balance Check**
```bash
# Trigger check manually (in production, runs every 10 minutes)
# Monitor logs for balance check output
tail -f logs/stellar-monitor.log | grep "health metrics"
```

2. **Test Alert Threshold**
```bash
# Temporarily lower threshold to trigger alert
STELLAR_MONITOR_BALANCE_THRESHOLD=999999
# Monitor logs for alert trigger
tail -f logs/stellar-monitor.log | grep -i alert
```

3. **Test Webhook**
```bash
# Set test webhook URL
ALERT_WEBHOOK_URL=https://webhook.site/your-unique-id
# Monitor webhook.site for incoming requests
```

### Unit Tests

Test coverage includes:
- Balance threshold comparison
- Fee metrics calculation
- Monthly burn projection
- Alert cooldown logic
- Webhook payload formatting
- Error handling

## Troubleshooting

### No Alerts Despite Low Balance

**Possible Causes**:
1. ALERT_WEBHOOK_URL not configured
   - Solution: Set webhook URL in environment
2. Alert cooldown active
   - Solution: Wait 1 hour or restart service
3. Balance threshold too low
   - Solution: Lower threshold in config

**Debug Steps**:
```bash
# Check logs for balance check runs
grep "health metrics" logs/stellar-monitor.log

# Check logs for alert attempts
grep -i "alert\|webhook" logs/stellar-monitor.log

# Verify config
echo $ALERT_WEBHOOK_URL
echo $STELLAR_MONITOR_BALANCE_THRESHOLD
```

### Inaccurate Fee Projections

**Causes**:
1. Insufficient transaction history
   - Solution: Wait for more transactions to accumulate
2. Recent major activity spikes
   - Solution: Monitor over longer period
3. Ledger cleanup or account merge
   - Solution: Manual validation of metrics

**Validation**:
```
Projected Monthly Burn = (Recent 100 TX Fees / Time Span) × 30
- If 10 TXs in 1 hour: Projection valid for 1+ days
- If 100 TXs in 10 days: Projection valid for trend analysis
- If < 10 TXs total: Insufficient data, use estimates only
```

### Webhook Delivery Issues

**Troubleshooting**:
1. Test webhook URL manually
```bash
curl -X POST https://hooks.slack.com/services/YOUR/WEBHOOK/URL \
  -H 'Content-Type: application/json' \
  -d '{"text": "Test message"}'
```

2. Check webhook authentication
   - Verify token/secret in URL
   - Ensure webhook hasn't expired

3. Validate payload format
   - Discord: Requires `embeds` array
   - Slack: Requires `text` field
   - PagerDuty: Requires severity field

4. Monitor webhook logs
   - Check Discord server
   - Check Slack workspace
   - Check PagerDuty incidents

## Performance Considerations

### Query Load
- Queries Horizon API every 10 minutes
- Fetches last 100 transactions per check
- Horizon rate limits: 3,600 requests/hour (easily within limits)

### Memory Usage
- Maintains minimal state
- No persistent transaction storage
- ~1-5 MB runtime footprint

### Network Impact
- 6 API calls per hour (negligible)
- ~10KB per alert webhook (minimal)

## Future Enhancements

Potential improvements for future iterations:

1. **Historical Tracking**
   - Store metrics to database
   - Track trends over time
   - Predictive burn rate analysis

2. **Multiple Thresholds**
   - Warning level (e.g., 100 XLM)
   - Critical level (e.g., 50 XLM)
   - Emergency level (e.g., 10 XLM)

3. **Smart Alerting**
   - Day-of-week based thresholds
   - Adaptive cooldown periods
   - Confidence scores on projections

4. **Integration**
   - USDC balance monitoring
   - Fee token monitoring
   - Custom asset tracking

5. **Automation**
   - Auto-funding from main account
   - Dynamic threshold adjustment
   - Predictive funding triggers

## References

- [Stellar Horizon API](https://developers.stellar.org/api/introduction/)
- [Stellar Operations & Transactions](https://developers.stellar.org/learn/encyclopedia/operations-and-transactions)
- [Stellar Expert Explorer](https://stellar.expert/)
- [NestJS Scheduling](https://docs.nestjs.com/techniques/task-scheduling)

## Monitoring Links

- **Production Dashboard**: [Link to monitoring dashboard]
- **Slack Channel**: #stellar-alerts
- **On-Call Runbook**: [Link to runbook]
- **Stellar Account**: `G...` (main platform wallet)

---

**Status**: Implementation complete for Issue #359  
**Last Updated**: 2026-06-28  
**Maintainer**: Backend Team
