import { Module, Global, OnApplicationBootstrap, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

/**
 * SentryModule initialises the Sentry SDK once at application startup.
 *
 * Marked @Global so any module that needs to call Sentry.captureException()
 * directly can do so without importing this module explicitly.
 *
 * Configuration is driven entirely by environment variables:
 *   SENTRY_DSN       — required in production; skipped when absent
 *   NODE_ENV         — sets the Sentry environment tag
 *   SENTRY_TRACES_SAMPLE_RATE — optional float (0–1), defaults to 0.1
 */
@Global()
@Module({})
export class SentryModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(SentryModule.name);

  onApplicationBootstrap(): void {
    const dsn = process.env.SENTRY_DSN;

    if (!dsn) {
      this.logger.warn(
        'SENTRY_DSN is not set — Sentry error reporting is disabled.',
      );
      return;
    }

    const tracesSampleRate = parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1',
    );

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: Number.isFinite(tracesSampleRate)
        ? tracesSampleRate
        : 0.1,
      // Redact sensitive database DSN strings from breadcrumbs
      beforeBreadcrumb(breadcrumb) {
        if (
          breadcrumb.category === 'db' &&
          typeof breadcrumb.message === 'string'
        ) {
          // Strip possible credential substrings from query breadcrumbs
          breadcrumb.message = breadcrumb.message.replace(
            /password=[^&\s]+/gi,
            'password=***',
          );
        }
        return breadcrumb;
      },
    });

    this.logger.log(
      `Sentry initialised (env: ${process.env.NODE_ENV ?? 'development'})`,
    );
  }
}
