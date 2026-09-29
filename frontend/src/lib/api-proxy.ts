import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

/**
 * Describes a single backend call that a Next.js API route wants
 * `withBackendProxy` to make on its behalf.
 */
export interface BackendProxyRequest {
  /** Backend path, e.g. `/trade-deals` or `/trade-deals?page=1`. Forwarded as-is to `fetchBackend`. */
  path: string;
  /** HTTP method to use for the backend call. Defaults to the incoming request's method. */
  method?: string;
  /** Extra headers to send to the backend. Merged on top of the default `Content-Type` and auth passthrough. */
  headers?: Record<string, string>;
  /**
   * Request body. Objects (and anything else that isn't already a string) are
   * JSON.stringify-ed automatically so callers can just pass the parsed body.
   */
  body?: unknown;
  /**
   * Status code to use for a successful (2xx) response, overriding the
   * backend's own status code. Useful for routes that intentionally return
   * e.g. 201 on create regardless of what the backend replied with.
   */
  status?: number;
  /**
   * Whether to automatically forward the caller's `Authorization` header to
   * the backend when the handler didn't already set one. Defaults to `true`.
   * Set to `false` for routes that must never forward credentials (e.g.
   * login/register, or public endpoints whose backend behavior changes based
   * on the presence of a token).
   */
  forwardAuth?: boolean;
}

export type BackendProxyHandler<Context = any> = (
  request: NextRequest,
  context: Context,
) => BackendProxyRequest | Promise<BackendProxyRequest>;

const UNAVAILABLE_RESPONSE = { message: 'Backend service is unavailable' } as const;
const INTERNAL_ERROR_RESPONSE = { message: 'Internal server error' } as const;

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
}

/**
 * Wraps a Next.js API route handler so it only has to describe *what*
 * backend call to make (`{ path, method, headers, body }`); this helper takes
 * care of actually calling `fetchBackend`, forwarding the Authorization
 * header, mapping an unreachable backend to a 503, mapping any other thrown
 * error to a 500, and translating the backend's JSON response into a
 * `NextResponse` — the pattern that used to be duplicated across every route
 * file under `src/app/api/**`.
 *
 * The inner `handler` receives the exact `(request, context)` arguments Next
 * .js passes to a route handler, so dynamic route params keep working
 * unchanged.
 */
export function withBackendProxy<Context = any>(handler: BackendProxyHandler<Context>) {
  return async function proxyRouteHandler(request: NextRequest, context: Context) {
    try {
      const {
        path,
        method,
        headers,
        body,
        status,
        forwardAuth = true,
      } = await handler(request, context);

      const outgoingHeaders: Record<string, string> = { ...(headers ?? {}) };

      if (forwardAuth && !hasAuthorizationHeader(outgoingHeaders)) {
        outgoingHeaders['Authorization'] = request.headers.get('authorization') ?? '';
      }

      const outgoingBody =
        body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

      const response = await fetchBackend(path, {
        method: method ?? request.method,
        headers: outgoingHeaders,
        body: outgoingBody,
      });

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(data, { status: response.status });
      }

      return NextResponse.json(data, { status: status ?? response.status });
    } catch (error: any) {
      if (error?.isBackendUnreachable) {
        return NextResponse.json(UNAVAILABLE_RESPONSE, { status: 503 });
      }
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };
}
