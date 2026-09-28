/**
 * Minimal stand-in for the NestJS backend, used by the investment-flow E2E.
 *
 * The deal page is a server component that fetches the deal from the backend
 * during SSR, which `page.route` cannot intercept — so Next.js is pointed at
 * this server instead. Browser-side calls are mocked in the spec itself.
 *
 * Only read-only deal endpoints are served; anything else returns 404 so a
 * missing mock fails loudly instead of reaching a real backend.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'),
);
const port = Number(process.env.MOCK_BACKEND_PORT || 3001);

function send(res, status, body, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, `http://localhost:${port}`);
    const origin = req.headers.origin;

    if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
    if (pathname === '/__health') return send(res, 200, { ok: true }, origin);

    if (req.method === 'GET' && pathname === '/v1/trade-deals') {
      return send(res, 200, { data: [fixtures.deal], total: 1, page: 1, limit: 12 }, origin);
    }
    if (req.method === 'GET' && pathname === `/v1/trade-deals/${fixtures.deal.id}`) {
      return send(res, 200, fixtures.deal, origin);
    }

    return send(res, 404, { message: `Not mocked: ${req.method} ${pathname}` }, origin);
  })
  .listen(port, () => {
    console.log(`[mock-backend] listening on http://localhost:${port}`);
  });
