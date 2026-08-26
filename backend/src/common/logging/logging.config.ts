import { Params } from 'nestjs-pino';

/**
 * Safely check if pino-pretty is available.
 * This prevents crashes when pino-pretty is not installed
 * (e.g., after npm ci --omit=dev in staging environments).
 */
function hasPinoPretty(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Use pretty printing when explicitly requested AND pino-pretty is installed.
 * In production (NODE_ENV=production) we always emit raw JSON for log
 * collectors (Fluentd, Logstash, etc.) regardless of LOG_PRETTY.
 */
const usePretty =
  process.env.LOG_PRETTY === 'true' &&
  process.env.NODE_ENV !== 'production' &&
  hasPinoPretty();

export const loggingConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL || 'info',

    // In production we emit raw JSON (no transport) so log collectors receive
    // machine-readable records.  In development we optionally pretty-print.
    transport: usePretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        }
      : undefined,

    // Emit { "level": "info" } instead of the numeric pino default { "level": 30 }
    // so that log collectors can filter by level name directly.
    formatters: {
      level: (label) => ({ level: label }),
    },

    // ISO-8601 timestamp on every record — compatible with Fluentd time parsing.
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,

    // Static fields present on every log record.
    base: {
      service: 'agri-fi-backend',
      version: process.env.npm_package_version || '0.1.0',
    },

    // Request / response serializers.  traceId is promoted to the top-level
    // inside genReqId / customProps so it surfaces on every HTTP log record.
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        traceId: req.traceId,
        // Keep correlationId for backwards-compat with existing dashboards.
        correlationId: req.correlationId ?? req.traceId,
        userAgent: req.headers?.['user-agent'],
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },

    // Promote traceId onto the root of every HTTP access log record so
    // queries like `jq 'select(.traceId=="...")' app.log` work without
    // digging inside the req object.
    customProps: (req: any) => ({
      traceId: req.traceId,
    }),

    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
      if (res.statusCode >= 500 || err) return 'error';
      return 'info';
    },
  },
};
