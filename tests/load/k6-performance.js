/**
 * k6 load test — marketplace trade deal API routes
 *
 * Issue #448: simulate peak marketplace traffic against list + fetch endpoints.
 *
 * Install k6 CLI:
 *   macOS:   brew install k6
 *   Linux:   sudo gpg -k && sudo gpg --no-default-keyring \
 *              --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
 *              --keyserver hkp://keyserver.ubuntu.com:80 \
 *              --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 && \
 *            echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
 *              sudo tee /etc/apt/sources.list.d/k6.list && \
 *            sudo apt-get update && sudo apt-get install k6
 *   Windows: choco install k6
 *   Docs:    https://grafana.com/docs/k6/latest/set-up/install-k6/
 *
 * Run (backend must be reachable with seeded open deals):
 *   k6 run tests/load/k6-performance.js
 *
 * Environment overrides:
 *   BASE_URL  — API origin (default http://localhost:3001)
 *   DEAL_ID   — fallback deal UUID when list response is empty
 *   VUS       — concurrent virtual users (default 100)
 *   DURATION  — steady-state duration (default 30s)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const FALLBACK_DEAL_ID =
  __ENV.DEAL_ID || 'b0000000-0000-0000-0000-000000000001';
const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || '30s';

export const options = {
  scenarios: {
    marketplace_deals: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:ListOpenDeals}': ['p(95)<200'],
    'http_req_duration{name:GetDealDetail}': ['p(95)<200'],
  },
};

export function setup() {
  const listUrl = `${BASE_URL}/v1/trade-deals?page=1&limit=12`;
  const response = http.get(listUrl, { tags: { name: 'SetupListOpenDeals' } });

  if (response.status !== 200) {
    return { dealId: FALLBACK_DEAL_ID };
  }

  try {
    const body = response.json();
    const firstDeal = body?.data?.[0];
    return { dealId: firstDeal?.id || FALLBACK_DEAL_ID };
  } catch {
    return { dealId: FALLBACK_DEAL_ID };
  }
}

export default function marketplaceLoad(data) {
  const listUrl = `${BASE_URL}/v1/trade-deals?page=1&limit=12`;
  const listResponse = http.get(listUrl, { tags: { name: 'ListOpenDeals' } });

  check(listResponse, {
    'list returns 200': (res) => res.status === 200,
    'list returns data array': (res) => {
      try {
        return Array.isArray(res.json('data'));
      } catch {
        return false;
      }
    },
  });

  let dealId = data.dealId;
  if (listResponse.status === 200) {
    try {
      const deals = listResponse.json('data');
      if (Array.isArray(deals) && deals.length > 0 && deals[0].id) {
        dealId = deals[0].id;
      }
    } catch {
      // keep setup fallback id
    }
  }

  const detailUrl = `${BASE_URL}/v1/trade-deals/${dealId}`;
  const detailResponse = http.get(detailUrl, { tags: { name: 'GetDealDetail' } });

  check(detailResponse, {
    'detail returns 200': (res) => res.status === 200,
    'detail includes id': (res) => {
      try {
        return res.json('id') === dealId;
      } catch {
        return false;
      }
    },
  });

  sleep(0.1);
}
