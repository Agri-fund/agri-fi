import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable Sentry in production to avoid noise during development
  enabled: process.env.NODE_ENV === 'production',

  // Capture 10% of transactions for performance monitoring
  tracesSampleRate: 0.1,

  // Capture 100% of sessions that include an error for session replay
  replaysOnErrorSampleRate: 1.0,

  // Capture 1% of all sessions for baseline session replay
  replaysSessionSampleRate: 0.01,

  integrations: [
    Sentry.replayIntegration({
      // Mask all text and block all media in replays to protect user privacy
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Ignore common browser noise that isn't actionable
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    /^Network Error$/,
    /^Failed to fetch$/,
    /^Load failed$/,
  ],

  beforeSend(event) {
    // Drop events with no stack trace (e.g. browser extensions)
    if (!event.exception?.values?.[0]?.stacktrace?.frames?.length) {
      return null;
    }
    return event;
  },
});
