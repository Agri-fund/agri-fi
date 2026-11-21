# Distributed Tracing (OpenTelemetry)

> **Issue:** #1233
> **Sources:** `backend/src/tracing/`, `devops/otel/collector-config.yaml`, `frontend/src/lib/tracing.ts`

## Overview

Agri-Fi instruments its backend with **OpenTelemetry** so a single request can be
followed across the HTTP API, outbound HTTP/Stellar calls and background work.
Traces are exported over OTLP to an **OpenTelemetry Collector**, visualised in
**Jaeger**, and reduced to RED metrics (rate, errors, duration) for Prometheus
alerting. The frontend propagates the W3C trace context so browser actions join
the same trace.

## Architecture

```
 browser ──traceparent──► backend (OTel SDK)
                              │  spans (OTLP/HTTP 4318)
                              ▼
                       otel-collector ──► Jaeger (UI :16686)
                              │
                              └─ spanmetrics ──► Prometheus (:8889) ──► alerts
```

## Backend bootstrap

`backend/src/tracing/tracing.ts` exports `startTracing()` / `shutdownTracing()`.
`main.ts` calls `startTracing()` **before** the Nest app is created and flushes
pending spans on `SIGTERM`/`SIGINT`.

`startTracing()` registers the process-wide OpenTelemetry singletons:

- **Resource**: `service.name`, `service.version`, `deployment.environment` and
  anything in `OTEL_RESOURCE_ATTRIBUTES`.
- **Sampler**: see [Sampling](#sampling).
- **Span processors**: `BatchSpanProcessor` with an OTLP exporter (when an
  endpoint is configured) and/or the console exporter (`OTEL_CONSOLE_EXPORT`).
- **Context manager**: `AsyncLocalStorageContextManager` (required for
  `context.active()` inside async handlers).
- **Propagator**: a `CompositePropagator` with **W3C Trace Context** and
  **W3C Baggage**.
- **axios interceptor**: injects `traceparent` on every outbound HTTP call.

Set `OTEL_SDK_DISABLED=true` to turn tracing off entirely.

## Instrumentation

| Layer                     | Location                                 | What it produces                                                 |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| HTTP (auto)               | `@opentelemetry/instrumentation-http`    | Automatic HTTP server spans, request/response details            |
| Express (auto)            | `@opentelemetry/instrumentation-express` | Express middleware tracing, route context                        |
| PostgreSQL (auto)         | `@opentelemetry/instrumentation-pg`      | TypeORM query spans, `db.statement`, duration                    |
| RabbitMQ (auto)           | `@opentelemetry/instrumentation-amqplib` | Pub/consume spans, routing keys, exchange names                  |
| Axios (auto)              | `@opentelemetry/instrumentation-axios`   | Outbound HTTP calls, status codes, URLs                          |
| Inbound HTTP (manual)     | `tracing.middleware.ts`                  | SERVER span per request, status code, method/path                |
| Route enrichment (manual) | `tracing.interceptor.ts`                 | `http.route`, `user.id`, `user.role`, span rename                |
| Stellar/Horizon (manual)  | `StellarService.callWithTracing()`       | Custom spans for Horizon API operations                          |
| Application code          | `TracingService`                         | `withSpan()` / `startSpan()` / `traceHorizonCall()` custom spans |
| Frontend                  | `frontend/src/lib/tracing.ts`            | `traceparent` on every API request                               |

### Auto-instrumentation

The backend uses `@opentelemetry/sdk-node` with automatic instrumentation plugins
that capture spans without code changes:

- **HTTP**: Inbound and outbound requests, status codes, headers
- **Express**: Route matching, middleware timing
- **PostgreSQL/TypeORM**: Database queries, prepared statements, connection pool
- **RabbitMQ/amqplib**: Message publish/consume, routing keys, exchanges
- **Axios**: HTTP client calls with trace propagation

### Manual instrumentation

Services can create custom spans via `TracingService`:

```ts
// Generic span wrapper
await this.tracing.withSpan(
  "operation.name",
  { attributes: { key: value } },
  async (span) => {
    // Your code here
  },
);

// Stellar/Horizon-specific span (with RPC attributes)
await this.tracing.traceHorizonCall(
  "loadAccount",
  { "stellar.account_id": publicKey },
  () => this.server.loadAccount(publicKey),
);
```

`TracingModule` is `@Global()`, so any service can inject `TracingService`:

```ts
await this.tracing.withSpan(
  "escrow.release",
  { attributes: { "escrow.id": escrowId } },
  async (span) => {
    span.setAttribute("amount", amount);
    return this.release(escrowId);
  },
);
```

### Middleware ordering

In `AppModule.configure()` the chain is:

```
HttpLoggerMiddleware → ClsMiddleware → TracingMiddleware → CorrelationIdMiddleware
```

`TracingMiddleware` extracts the upstream `traceparent`, starts the server span
and sets `req.traceId` to the OpenTelemetry trace id. `CorrelationIdMiddleware`
then **adopts** that id (falling back to `x-trace-id`/uuid), and pino attaches it
to every log line — so logs and traces share the same trace id.

## Propagation

- **Inbound**: the W3C `traceparent` header is extracted by the middleware, so
  requests from other instrumented services (or the frontend) continue the trace.
- **Outbound**: the global axios interceptor injects `traceparent` into calls to
  Stellar/Horizon, webhooks and other services.
- **Frontend**: `traceHeaders()` adds `traceparent` to every `fetch`, and
  `captureTraceId()` records the server's `x-trace-id` response header so errors
  can be reported with the trace id.

## Sampling

| `OTEL_TRACES_SAMPLER`      | Behaviour                                    |
| -------------------------- | -------------------------------------------- |
| `always_on`                | Sample every trace                           |
| `always_off`               | Sample none                                  |
| `traceidratio`             | Sample a fraction                            |
| `parentbased_traceidratio` | Respect the upstream decision, else fraction |

`OTEL_TRACES_SAMPLER_ARG` sets the ratio. Without an explicit sampler the
default samples 100% outside production and `OTEL_TRACES_SAMPLE_RATIO` (default
`0.1`) in production. `ParentBasedSampler` ensures a sampled root keeps its whole
trace sampled.

## Collection

`devops/otel/collector-config.yaml` runs the Collector with:

- **Receivers**: OTLP gRPC (`4317`) and HTTP (`4318`).
- **Processors**: `memory_limiter`, `resourcedetection`, `attributes`, `batch`.
- **Connectors**: `spanmetrics` — derives `calls_total` and `latency` histograms
  with `service.name`, `http.method`, `http.status_code` dimensions.
- **Exporters**: `otlp/jaeger` (traces) and `prometheus` (`:8889`, metrics).
- **Extension**: `health_check` (`:13133`).

## Visualization

Jaeger all-in-one serves the UI on **http://localhost:16686**. Search by
service, operation, minimum duration, tags (`http.status_code`, `user.id`) or by
`traceId`. A trace shows the full span tree with per-span timing so the slowest
hop is obvious.

## Span enrichment

Spans carry business context beyond the defaults:

| Attribute                                                                  | Source                              |
| -------------------------------------------------------------------------- | ----------------------------------- |
| `http.request.method`, `url.path`, `user_agent.original`, `client.address` | middleware                          |
| `http.response.status_code`                                                | middleware (`finish`)               |
| `http.route`, `user.id`, `user.role`, `enduser.id`, `app.trace_id`         | interceptor                         |
| `deployment.environment`, `service.version`                                | resource                            |
| custom attributes                                                          | `TracingService.withSpan()` callers |

Errors are recorded via `span.recordException()` plus an ERROR status, so failed
requests are queryable in Jaeger and counted by `spanmetrics`.

## Analytics & alerting

The `spanmetrics` connector exposes RED metrics on `otel-collector:8889`, which
Prometheus scrapes (`job_name: otel-collector`). Rules in
`devops/prometheus/alerts.yaml` (`agri_fi_distributed_tracing`):

| Alert                             | Condition                         |
| --------------------------------- | --------------------------------- |
| `TracingHighServiceErrorRate`     | error-span ratio **> 5%** (5m)    |
| `TracingCriticalServiceErrorRate` | error-span ratio **> 25%** (2m)   |
| `TracingP95LatencyHigh`           | p95 latency **> 2s** (5m)         |
| `TracingCollectorDown`            | collector scrape target down (3m) |

## Retention

Jaeger all-in-one in `docker-compose.yml` uses in-memory storage bounded by
`MEMORY_MAX_TRACES` (`50000`) — fine for development, not durable. For production
point the collector's `otlp/jaeger` exporter (or an `elasticsearch` exporter) at
a durable backend (Elasticsearch/Cassandra/Tempo) with an index-retention policy;
sampling keeps volumes manageable.

## Configuration

| Variable                             | Default           | Purpose                                     |
| ------------------------------------ | ----------------- | ------------------------------------------- |
| `OTEL_SDK_DISABLED`                  | `false`           | Disable tracing entirely                    |
| `OTEL_SERVICE_NAME`                  | `agri-fi-backend` | `service.name` resource attribute           |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | _(unset)_         | Base OTLP endpoint (`…/v1/traces` appended) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | _(unset)_         | Full OTLP traces URL (overrides base)       |
| `OTEL_EXPORTER_OTLP_HEADERS`         | _(unset)_         | `k1=v1,k2=v2` exporter headers              |
| `OTEL_TRACES_SAMPLER`                | _(ratio default)_ | Sampler name                                |
| `OTEL_TRACES_SAMPLER_ARG`            | `0.1`             | Ratio for the sampler                       |
| `OTEL_TRACES_SAMPLE_RATIO`           | `0.1`             | Default ratio in production                 |
| `OTEL_RESOURCE_ATTRIBUTES`           | _(unset)_         | Additional resource attributes              |
| `OTEL_DEPLOYMENT_ENVIRONMENT`        | `NODE_ENV`        | `deployment.environment`                    |
| `OTEL_CONSOLE_EXPORT`                | `false`           | Also print spans to stdout (dev)            |
| `OTEL_DIAG_LOG_LEVEL`                | _(unset)_         | OTel diagnostic logging level               |

## Operations

```bash
# Bring up the tracing stack
docker compose up -d otel-collector jaeger

# Verify the collector is healthy
curl -s localhost:13133 | jq .

# Check span metrics are flowing
curl -s localhost:8889/metrics | grep calls_total | head

# Open Jaeger
open http://localhost:16686
```

Common Jaeger queries: `service=agri-fi-backend`, filter
`http.status_code>=500` for failing requests, or search by `user.id` to follow
one account's activity.

## Testing

`backend/src/tracing/tracing.spec.ts` verifies span creation, error recording,
context round-tripping, upstream trace continuation and the middleware's
`traceparent` adoption/enrichment using an `InMemorySpanExporter`.
`frontend/src/lib/__tests__/tracing.test.ts` verifies traceparent generation,
header injection and response trace-id capture.
