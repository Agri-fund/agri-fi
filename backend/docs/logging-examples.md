# Structured JSON Logging

## Overview

All log records emitted by the backend are structured JSON objects compatible
with Fluentd, Logstash, and CloudWatch Logs Insights.  Every record includes:

| Field       | Type   | Description |
|-------------|--------|-------------|
| `level`     | string | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `timestamp` | string | ISO-8601 UTC — e.g. `"2026-07-26T21:11:19.335Z"` |
| `service`   | string | Always `"agri-fi-backend"` |
| `version`   | string | npm package version |
| `traceId`   | string | UUID generated per-request (or forwarded from `x-trace-id` header) |
| `msg`       | string | Human-readable description of the event |

---

## Trace ID flow

A `traceId` is generated (or forwarded) for every HTTP request by
`CorrelationIdMiddleware` and stored in three places so it appears on **every**
log line produced during the request lifecycle:

1. `req.traceId` — consumed by pino-http `customProps` / serializers.
2. CLS store (`ClsService`) — so async code called from the request scope can
   read it via `cls.get('traceId')`.
3. Pino child logger — bound via `PinoLogger.assign({ traceId })` so all
   `PinoLogger` calls within the request scope automatically include it.

### Forwarding a trace ID from an API gateway

```
POST /v1/trade-deals/123/publish
x-trace-id: gateway-generated-uuid
```

If no `x-trace-id` header is present, a fresh UUID v4 is generated.

---

## Log record examples

### HTTP access log (pino-http)

```json
{
  "level": "info",
  "timestamp": "2026-07-26T21:11:19.335Z",
  "service": "agri-fi-backend",
  "version": "0.1.0",
  "traceId": "req-abc-123",
  "req": {
    "method": "POST",
    "url": "/v1/trade-deals/123/publish",
    "traceId": "req-abc-123",
    "correlationId": "req-abc-123",
    "userAgent": "Mozilla/5.0"
  },
  "res": { "statusCode": 200 },
  "responseTime": 42,
  "msg": "request completed"
}
```

### Service layer (TradeDealsService)

```json
{
  "level": "info",
  "timestamp": "2026-07-26T21:11:19.400Z",
  "service": "agri-fi-backend",
  "traceId": "req-abc-123",
  "dealId": "123",
  "msg": "Creating escrow account for deal"
}
```

### Stellar service

```json
{
  "level": "info",
  "timestamp": "2026-07-26T21:11:19.500Z",
  "service": "agri-fi-backend",
  "traceId": "req-abc-123",
  "tradeDealId": "123",
  "escrowPublicKey": "GESCROW123...",
  "msg": "Escrow account created successfully"
}
```

### Queue / async job (RabbitMQ)

```json
{
  "level": "info",
  "timestamp": "2026-07-26T21:11:19.600Z",
  "service": "agri-fi-backend",
  "traceId": "req-abc-123",
  "event": "deal.publish",
  "msg": "Emitted event: deal.publish"
}
```

### Error with trace context

```json
{
  "level": "error",
  "timestamp": "2026-07-26T21:11:20.000Z",
  "service": "agri-fi-backend",
  "traceId": "req-abc-123",
  "dealId": "123",
  "err": { "message": "Stellar network timeout", "type": "Error" },
  "msg": "Failed to publish deal"
}
```

---

## Configuration

| Env var      | Default       | Description |
|--------------|---------------|-------------|
| `LOG_LEVEL`  | `info`        | Minimum log level to emit |
| `LOG_PRETTY` | `true`        | Enable pino-pretty in **non-production** only; production always emits raw JSON |
| `NODE_ENV`   | `development` | When `production`, `LOG_PRETTY` is ignored and raw JSON is always emitted |

---

## Searching logs

### Development (pretty logs)
```bash
grep "req-abc-123" logs/app.log
```

### Production (JSON logs)
```bash
# All records for a single trace
jq 'select(.traceId == "req-abc-123")' app.log

# All error records in the last hour
jq 'select(.level == "error")' app.log

# Errors for a specific deal
jq 'select(.level == "error" and .dealId == "123")' app.log

# Fluentd / CloudWatch Logs Insights
fields @timestamp, traceId, level, msg
| filter level = "error"
| sort @timestamp desc
```

---

## Log levels

| Level   | Usage |
|---------|-------|
| `trace` | Highly verbose diagnostics (disabled in production) |
| `debug` | Developer diagnostics — SQL queries, Stellar XDR details |
| `info`  | Normal operations, successful completions |
| `warn`  | Recoverable issues, retry attempts, validation warnings |
| `error` | Failures requiring attention, exceptions, Stellar errors |
| `fatal` | Process-level failures causing shutdown |

---

## Best practices

1. **Always include `traceId`**: Pass it to sub-service calls or queue messages so async jobs can be correlated.
2. **Include relevant entity IDs**: `dealId`, `investmentId`, `userId`, etc.
3. **Use structured objects for data, strings for messages**: `logger.info({ dealId }, 'Deal published')`.
4. **Be consistent with field names** across services so aggregation queries work.
5. **Never log secrets, private keys, or PII** — use IDs that reference database records instead.
