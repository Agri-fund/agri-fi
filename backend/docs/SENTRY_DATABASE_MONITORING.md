## Sentry Database Failure Monitoring Implementation

### Overview

This implementation enhances the backend's monitoring and alerting capabilities by routing database connection errors and transaction failures directly to Sentry for immediate visibility and investigation.

### What's New

#### 1. **HttpExceptionFilter Enhancement** (`src/common/filters/http-exception.filter.ts`)

The existing global exception filter has been refined with:

- **Database Error Detection**: Comprehensive identification of database layer failures using:
  - PostgreSQL SQLSTATE codes (connection failures, constraint violations, transaction errors)
  - Common connection patterns (ECONNREFUSED, ETIMEDOUT, ECONNRESET)
  - TypeORM-specific error patterns (QueryFailedError, EntityNotFoundError)

- **Sentry Integration**: All database errors are automatically captured with:
  - `error.type: "database"` tag for easy filtering
  - Request context (method, URL, correlation ID)
  - User organization IDs (for production tracing)
  - HTTP status codes and error severity levels

- **Production Safety**: In production environments, sensitive database error messages are redacted from client responses while still being fully captured in Sentry.

#### 2. **DatabaseTransactionInterceptor** (New: `src/common/filters/database-transaction.interceptor.ts`)

A complementary global interceptor that provides enhanced context for database operations:

- **Operation Tracking**: Tags each database operation with method and endpoint information
- **Transaction Context**: Attaches detailed information about the failing operation to Sentry
- **Error Code Mapping**: Extracts and tags PostgreSQL error codes for correlation with database documentation
- **Lightweight**: Only activates on database errors, adding minimal overhead to successful requests

#### 3. **SentryModule Initialization** (`src/common/logger/sentry.module.ts`)

The Sentry SDK is initialized at application bootstrap with:

- **Environment Configuration**: Respects `NODE_ENV` and `SENTRY_DSN` settings
- **Breadcrumb Redaction**: Automatically strips password and credential references from query logs
- **Trace Sampling**: Configurable via `SENTRY_TRACES_SAMPLE_RATE` (defaults to 10% in production)

### Acceptance Criteria Met

✅ **Database exceptions are reported to Sentry immediately**
- All database errors (connection failures, constraint violations, timeouts) are captured through the global HttpExceptionFilter
- The DatabaseTransactionInterceptor provides additional context enrichment at the service layer

✅ **Sentry errors include context data like user organization IDs**
- User information is attached to every database error report:
  - User ID (from authenticated JWT)
  - Organization ID (for multi-tenant correlation)
  - User role (for permission-based analysis)
- Request metadata (correlation ID, HTTP method, path) is captured
- All data is tagged appropriately for Sentry dashboards and alerts

### Error Handling Example Flow

1. **A database connection timeout occurs in a trade deal operation**
   ```
   User makes request → HTTP Handler → Database Operation → Connection timeout
   ```

2. **Error is caught by HttpExceptionFilter**
   - Error is identified as database-type
   - Context is extracted (userId, organizationId, endpoint)
   - Event is sent to Sentry with tags and user info

3. **DatabaseTransactionInterceptor provides additional context**
   - Operation ("POST /api/deals") is tagged
   - Request path and method are attached
   - PostgreSQL error code (08006 - connection_failure) is tagged

4. **Sentry receives complete event with all context**
   - Alerts ops team if configured
   - Error is correlated with user account and organization
   - Ops can investigate database logs using timestamp and correlation ID

### Configuration

**Environment Variables Required:**

```bash
# Required for Sentry integration (optional in development)
SENTRY_DSN=https://your-key@sentry.io/your-project-id

# Optional: Performance monitoring sample rate (0-1, default: 0.1)
SENTRY_TRACES_SAMPLE_RATE=0.1

# Database configuration (existing)
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=***
DATABASE_NAME=agric_onchain
```

### Testing

Comprehensive test suites verify:

- **HttpExceptionFilter** (18 tests):
  - Correct HTTP status code mapping
  - Database error detection (connection errors, SQLSTATE codes, TypeORM patterns)
  - Proper Sentry context attachment (user, org, request metadata)
  - No false positives (4xx errors don't trigger alerts)

- **DatabaseTransactionInterceptor** (7 tests):
  - Successful requests pass through without overhead
  - Database errors trigger Sentry context enhancement
  - Error codes are properly extracted and tagged
  - Non-database errors don't trigger enhancement

### Monitoring Benefits

1. **Rapid Incident Response**: Database failures are immediately visible in Sentry dashboards
2. **Root Cause Analysis**: Full request context helps identify if failures are user-specific or systemic
3. **Multi-Tenant Tracking**: Organization IDs enable per-customer SLA monitoring
4. **Actionable Alerts**: Tagged errors allow sophisticated alert routing (e.g., connection failures → database team)
5. **Compliance**: Error tracking helps with production readiness verification and regulatory requirements

### Integration Points

The implementation is fully integrated at the application level:

- **app.module.ts**: HttpExceptionFilter and DatabaseTransactionInterceptor are registered as global providers
- **main.ts**: Uses enhanced error handling through established middleware chain
- **No breaking changes**: Fully backward compatible with existing error handling

### Future Enhancements

Potential improvements for future iterations:

1. **Query Performance Metrics**: Track slow query execution times in Sentry
2. **Connection Pool Monitoring**: Alert on pool exhaustion or connection leaks
3. **Transaction Duration Tracking**: Monitor long-running transactions that lock resources
4. **Automated Recovery**: Implement circuit breakers for cascading database failures
5. **Custom Alerts**: Set up Sentry alerts for specific error patterns (e.g., all 23505 constraint violations)

### Related Issues

- #730: Original requirement for database failure monitoring
- #742: Connection pool monitoring (complementary feature)
- #744: Transaction visibility improvements (complementary feature)
