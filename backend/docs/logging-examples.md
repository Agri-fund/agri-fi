# Logging Examples

## Correlation ID Flow

The logging system automatically tracks requests end-to-end using correlation IDs. Here's how it works:

### 1. HTTP Request
```
POST /trade-deals/123/publish
x-correlation-id: req-abc-123
```

### 2. Service Layer (TradeDealsService)
```json
{
  "level": "info",
  "timestamp": "2026-04-23T22:45:00.000Z",
  "service": "agri-fi-backend",
  "correlationId": "req-abc-123",
  "dealId": "123",
  "msg": "Creating escrow account for deal"
}
```

### 3. Stellar Service
```json
{
  "level": "info", 
  "timestamp": "2026-04-23T22:45:01.000Z",
  "service": "agri-fi-backend",
  "correlationId": "req-abc-123",
  "tradeDealId": "123",
  "escrowPublicKey": "GESCROW123...",
  "msg": "Escrow account created successfully"
}
```

### 4. Queue Service (RabbitMQ)
```json
{
  "level": "info",
  "timestamp": "2026-04-23T22:45:02.000Z", 
  "service": "agri-fi-backend",
  "correlationId": "req-abc-123",
  "event": "deal.publish",
  "msg": "Emitted event: deal.publish"
}
```

### 5. Queue Processor (Async Job)
```json
{
  "level": "info",
  "timestamp": "2026-04-23T22:45:03.000Z",
  "service": "agri-fi-backend", 
  "correlationId": "req-abc-123",
  "dealId": "123",
  "msg": "Processing deal.publish for deal 123"
}
```

## Investment Flow Example

A complete investment flow with correlation ID `inv-xyz-789`:

```json
// 1. Investment creation
{
  "level": "info",
  "correlationId": "inv-xyz-789",
  "investmentId": "inv-456",
  "tradeDealId": "deal-123", 
  "tokenAmount": 10,
  "msg": "Investment created successfully"
}

// 2. Stellar transaction
{
  "level": "info",
  "correlationId": "inv-xyz-789", 
  "investmentId": "inv-456",
  "txId": "stellar-tx-abc",
  "msg": "Successfully funded investment with Stellar transaction"
}

// 3. Escrow release (if deal becomes funded)
{
  "level": "info",
  "correlationId": "inv-xyz-789",
  "tradeDealId": "deal-123",
  "investorCount": 5,
  "msg": "Deal deal-123 fully funded — notifying 5 investor(s)"
}
```

## Error Handling

Errors maintain correlation context:

```json
{
  "level": "error",
  "correlationId": "req-abc-123",
  "dealId": "123", 
  "error": "Stellar network timeout",
  "msg": "Failed to publish deal - Stellar operations failed"
}
```

## Searching Logs

To trace a complete request flow:

```bash
# Development (pretty logs)
grep "req-abc-123" logs/app.log

# Production (JSON logs)
jq 'select(.correlationId == "req-abc-123")' logs/app.log
```

## Log Levels

- **info**: Normal operations, successful completions
- **warn**: Recoverable issues, retry attempts, validation warnings  
- **error**: Failures requiring attention, exceptions, Stellar errors

## Best Practices

1. **Always include relevant IDs**: `dealId`, `investmentId`, `userId`, etc.
2. **Use structured data**: Objects for data, strings for messages
3. **Be consistent**: Same field names across services
4. **Include context**: Enough information to understand what happened
5. **Avoid sensitive data**: Never log secrets, private keys, or PII