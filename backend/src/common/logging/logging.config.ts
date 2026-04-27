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

export const loggingConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.LOG_PRETTY === 'true' && hasPinoPretty()
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
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    base: {
      service: 'agri-fi-backend',
      version: process.env.npm_package_version || '0.1.0',
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        correlationId: req.correlationId,
        userAgent: req.headers['user-agent'],
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    customLogLevel: function (req, res, err) {
      if (res.statusCode >= 400 && res.statusCode < 500) {
        return 'warn';
      } else if (res.statusCode >= 500 || err) {
        return 'error';
      }
      return 'info';
    },
  },
};
