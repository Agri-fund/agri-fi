# Soroban Event Indexing Service

The Soroban Event Indexing Service provides real-time synchronization of on-chain state changes from Soroban smart contracts to the local database.

## Overview

This service:
- **Polls Horizon API** for new contract events from deployed Soroban contracts
- **Tracks processed events** to prevent duplicate database updates
- **Updates database records** based on on-chain state changes
- **Emits internal events** for downstream processing via RabbitMQ
- **Handles retries** and error recovery gracefully

## Architecture

```
┌─────────────────────┐
│  Soroban Contracts  │
│  (On-chain)         │
└──────────┬──────────┘
           │
           │ Events emitted
           ▼
┌─────────────────────────────┐
│  Horizon / RPC API          │
│  (Event Stream)             │
└──────────┬──────────────────┘
           │
           │ Polling (10s)
           ▼
┌─────────────────────────────────────┐
│  SorobanEventIndexer Service        │
│  - Query events from RPC            │
│  - Deduplicate using cache          │
│  - Route by contract/event type     │
│  - Update database                  │
│  - Emit internal events             │
└──────────┬──────────────────────────┘
           │
           ├─► Database (PostgreSQL)
           │   - TransactionLog
           │   - ShipmentMilestone
           │   - TradeDeal
           │
           └─► QueueService (RabbitMQ)
               - milestone.completed
               - investment.confirmed
               - deal.status.changed
```

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Soroban Event Indexing
SOROBAN_EVENT_INDEXING_ENABLED=true
SOROBAN_EVENT_POLLING_INTERVAL_MS=10000  # Poll every 10 seconds

# Contract Addresses (required for event filtering)
FARM_CAMPAIGN_CONTRACT=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PROJECT_FACTORY_CONTRACT=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
REVENUE_DISTRIBUTOR_CONTRACT=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
MARKETPLACE_SETTLEMENT_CONTRACT=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# RPC Configuration
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
```

### Service Initialization

The event indexer is automatically initialized when the SorobanModule is imported in your application:

```typescript
import { SorobanModule } from './soroban/soroban.module';

@Module({
  imports: [
    SorobanModule,
    // ... other modules
  ],
})
export class AppModule {}
```

## Supported Events

### FarmCampaign Contract Events

| Event | Data | Action |
|-------|------|--------|
| `milestone_completed` | `dealId`, `milestoneIndex` | Updates ShipmentMilestone, emits `milestone.completed` |
| `funding_received` | `dealId`, `investorId`, `amount` | Updates TransactionLog, emits `investment.confirmed` |
| `campaign_status_changed` | `dealId`, `newStatus` | Updates TradeDeal status, emits `deal.status.changed` |

### MarketplaceSettlement Contract Events

| Event | Data | Action |
|-------|------|--------|
| `settlement_completed` | `dealId`, `settlementAmount` | Emits `settlement.completed` |
| `trade_settled` | `dealId` | Emits `trade.settled` |

### RevenueDistributor Contract Events

| Event | Data | Action |
|-------|------|--------|
| `revenue_distributed` | `dealId`, `amount`, `distributionCount` | Emits `revenue.distributed` |

## Event Emission Pattern

When a contract event is processed, the service emits internal events via QueueService:

```typescript
// Example: Milestone completion
this.queueService.emit('milestone.completed', {
  dealId: 'deal-123',
  milestoneIndex: 1,
  txHash: 'txhash...',
  timestamp: new Date(),
});
```

Subscribe to these events in your services:

```typescript
@EventPattern('milestone.completed')
async handleMilestoneCompleted(data: any) {
  // React to milestone completion
  console.log('Milestone completed:', data);
}
```

## Event Deduplication

The service maintains an in-memory cache of processed events to prevent duplicate processing:

- **Cache key**: `${transactionHash}-${contractId}-${eventType}`
- **Cache size**: Kept at 1000 most recent entries
- **Persistence**: Cache is cleared on service restart

For persistence across restarts, consider adding a `processed_events` table to the database.

## Error Handling

### Graceful Degradation

If the event indexer fails to initialize:
- Application continues to start normally
- Indexing is disabled
- Manual event polling can still be triggered via API

### Retry Logic

- Failed event processing is logged but doesn't block subsequent events
- Errors are non-blocking per event
- Service continues polling even if individual events fail

### Logging

All events are logged at appropriate levels:

```
DEBUG: Events retrieved and processed
INFO:  Significant state changes (milestone completed, funding received)
WARN:  Processing errors, missing contract data
ERROR: Critical indexing failures
```

## Usage

### Get Indexer Status

```typescript
@Get('status')
getIndexerStatus() {
  return this.eventIndexer.getStatus();
}

// Response
{
  "isRunning": true,
  "lastLedger": 12345,
  "processedEventsCount": 42
}
```

### Trigger Manual Poll

```typescript
@Post('poll-once')
async pollOnce() {
  await this.eventIndexer.pollOnce();
  return { message: 'Polling triggered' };
}
```

## Performance Considerations

### Polling Interval

- **Default**: 10 seconds
- **Faster polling**: Use smaller `SOROBAN_EVENT_POLLING_INTERVAL_MS` (e.g., 5000)
  - Pro: More real-time updates
  - Con: Higher RPC load
- **Slower polling**: Use larger interval (e.g., 30000)
  - Pro: Lower RPC load
  - Con: Delayed database updates

### Database Impact

Event processing creates database transactions for each event:
- Consider implementing batch updates for high-volume scenarios
- Monitor database connection pool size
- Index `transaction_logs.tx_hash` and `shipment_milestones.stellar_tx_id` for faster lookups

### Cache Size

- Current limit: 1000 entries
- Each entry: ~200 bytes (string keys + metadata)
- Total: ~200KB memory
- Adjust if processing very high event volume

## Testing

### Unit Tests

```typescript
describe('SorobanEventIndexer', () => {
  it('should process milestone_completed event', async () => {
    const event = {
      type: 'milestone_completed',
      contractId: farmCampaignAddress,
      value: { dealId: 'deal-1', milestoneIndex: 1 },
      transactionHash: 'hash123',
    };

    await indexer.handleFarmCampaignEvent(event);

    expect(milestoneRepo.save).toHaveBeenCalled();
    expect(queueService.emit).toHaveBeenCalledWith(
      'milestone.completed',
      expect.any(Object),
    );
  });
});
```

### E2E Testing

Set up a local Soroban contract and emit test events:

1. Deploy test contract
2. Emit contract events
3. Verify database updates
4. Verify internal event emissions

## Troubleshooting

### Events Not Being Processed

**Problem**: Event indexer is running but no database updates

**Solutions**:
1. Verify contract addresses are correct in `.env`
2. Check Soroban RPC connectivity: `curl https://soroban-testnet.stellar.org/`
3. Verify events are actually emitted on-chain: Check explorer
4. Check logs for polling errors

### High CPU/Memory Usage

**Problem**: Event indexer consuming excessive resources

**Solutions**:
1. Increase `SOROBAN_EVENT_POLLING_INTERVAL_MS` (poll less frequently)
2. Verify no infinite loops in event handlers
3. Check database query performance
4. Monitor cache size via `getIndexerStatus()`

### Duplicate Database Updates

**Problem**: Same event processed multiple times

**Solutions**:
1. Cache should prevent duplicates - check if restarted
2. Verify transaction hash uniqueness
3. Check for concurrent instances of indexer

## Future Enhancements

- [ ] Persist processed events to database for crash recovery
- [ ] Implement event subscription via WebSocket (instead of polling)
- [ ] Add metrics/monitoring (Prometheus integration)
- [ ] Batch event processing for performance
- [ ] Smart retry logic with exponential backoff
- [ ] Event filtering by contract and topic
- [ ] Real-time alerts for critical events

## References

- [Soroban Documentation](https://developers.stellar.org/docs/smart-contracts)
- [Horizon API Events](https://developers.stellar.org/api/introduction/async-events/)
- [Stellar RPC Reference](https://soroban-rpc.stellar.org/)
