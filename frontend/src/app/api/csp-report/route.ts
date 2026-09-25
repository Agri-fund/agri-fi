import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const cspReport = body['csp-report'] || body;

    // Capture CSP violation event in Sentry
    Sentry.withScope((scope) => {
      scope.setTag('csp-violation', 'true');
      scope.setExtra('csp-report', cspReport);

      const documentUri = cspReport['document-uri'] || 'unknown';
      const blockedUri = cspReport['blocked-uri'] || 'unknown';
      const violatedDirective = cspReport['violated-directive'] || 'unknown';

      Sentry.captureMessage(
        `CSP Violation: ${violatedDirective} blocked ${blockedUri} on ${documentUri}`,
        'warning',
      );
    });

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid report' }, { status: 400 });
  }
}
