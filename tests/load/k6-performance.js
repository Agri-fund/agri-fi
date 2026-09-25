/**
 * k6 load test — Agri-Fi marketplace + investment + escrow payout flows
 *
 * Simulates the major pre-production bottlenecks:
 *  - browse open trade deals
 *  - create investment requests at peak concurrency
 *  - trigger escrow payout via shipment milestone completion
 *
 * Environment overrides:
 *   BASE_URL             — API origin (default http://localhost:3001)
 *   DEAL_ID              — fallback open deal used by the investment flow
 *   INVESTOR_EMAIL       — investor login used by the investment load scenario
 *   INVESTOR_PASSWORD    — investor password (default Password123!)
 *   TRADER_EMAIL         — trader login used by the payout scenario
 *   TRADER_PASSWORD      — trader password (default Password123!)
 *   VUS                  — default concurrency for the marketplace baseline
 *   DURATION             — default duration (default 30s)
 *   INVESTMENT_VUS       — investment flow virtual users
 *   PAYOUT_VUS           — payout flow virtual users
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const FALLBACK_DEAL_ID = __ENV.DEAL_ID || 'b0000000-0000-0000-0000-000000000001';
const INVESTOR_EMAIL = __ENV.INVESTOR_EMAIL || 'investor@agri-fi.demo';
const INVESTOR_PASSWORD = __ENV.INVESTOR_PASSWORD || 'Password123!';
const TRADER_EMAIL = __ENV.TRADER_EMAIL || 'trader@agri-fi.demo';
const TRADER_PASSWORD = __ENV.TRADER_PASSWORD || 'Password123!';
const VUS = Number(__ENV.VUS || 40);
const DURATION = __ENV.DURATION || '30s';
const INVESTMENT_VUS = Number(__ENV.INVESTMENT_VUS || 12);
const PAYOUT_VUS = Number(__ENV.PAYOUT_VUS || 6);

const AUTH = {
  headers: {
    'Content-Type': 'application/json',
  },
};

function jwtHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
}

function withTag(tags) {
  return {
    tags,
  };
}

function extractFirstDealId(response, preferredStatus) {
  try {
    const body = response.json();
    const nodes = Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body)
          ? body
          : [];

    const byStatus = preferredStatus
      ? nodes.find((d) => d?.status === preferredStatus)
      : null;

    return byStatus?.id || nodes[0]?.id || null;
  } catch {
    return null;
  }
}

function login(email, password) {
  const res = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email, password }),
    withTag({ name: 'Login' }),
  );

  check(res, {
    'login returns 200': (r) => r.status === 200,
    'login returns token': (r) => !!(r.json('accessToken') || r.json('token')),
  });

  return res.json('accessToken') || res.json('token') || null;
}

export const options = {
  scenarios: {
    marketplace_deals: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      tags: { flow: 'marketplace' },
    },
    investment_creation: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '30s', target: INVESTMENT_VUS },
        { duration: '2m', target: INVESTMENT_VUS },
        { duration: '30s', target: Math.max(2, Math.floor(INVESTMENT_VUS / 2)) },
      ],
      gracefulStop: '30s',
      tags: { flow: 'investment_creation' },
    },
    escrow_payout: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: PayoutMax(PAYOUT_VUS) },
        { duration: '2m', target: PayoutMax(PAYOUT_VUS) },
        { duration: '20s', target: 1 },
      ],
      gracefulStop: '30s',
      tags: { flow: 'escrow_payout' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{name:ListOpenDeals}': ['p(95)<250'],
    'http_req_duration{name:GetDealDetail}': ['p(95)<250'],
    'http_req_duration{name:CreateInvestment}': ['p(95)<1500'],
    'http_req_duration{name:FundEscrow}': ['p(95)<2000'],
    'http_req_duration{name:RecordImporterMilestone}': ['p(95)<2000'],
  },
};

function PayoutMax(value) {
  return Math.max(1, value);
}

export function setup() {
  const investorToken = login(INVESTOR_EMAIL, INVESTOR_PASSWORD);
  const traderToken = login(TRADER_EMAIL, TRADER_PASSWORD);

  const listRes = http.get(
    `${BASE_URL}/v1/trade-deals?page=1&limit=20`,
    jwtHeaders(investorToken || ''),
  );

  const openDealId = extractFirstDealId(listRes, 'open') || FALLBACK_DEAL_ID;

  const payoutListRes = http.get(
    `${BASE_URL}/v1/trade-deals?page=1&limit=20`,
    jwtHeaders(traderToken || ''),
  );

  const payoutDealId = extractFirstDealId(payoutListRes, 'delivered') || openDealId;

  return {
    investorToken,
    traderToken,
    dealId: openDealId,
    payoutDealId,
  };
}

export default function marketplaceLoad(data) {
  const listUrl = `${BASE_URL}/v1/trade-deals?page=1&limit=12`;
  const listResponse = http.get(listUrl, withTag({ name: 'ListOpenDeals' }));

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

  const dealId = extractFirstDealId(listResponse, 'open') || data.dealId;

  const detailUrl = `${BASE_URL}/v1/trade-deals/${dealId}`;
  const detailResponse = http.get(detailUrl, withTag({ name: 'GetDealDetail' }));

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

export function investment_creation(data) {
  const token = data.investorToken;
  if (!token) {
    return;
  }

  const dealId = extractFirstDealId(
    http.get(
      `${BASE_URL}/v1/trade-deals?page=1&limit=20`,
      jwtHeaders(token),
    ),
    'open',
  ) || data.dealId;

  const tokenAmount = 10 + ((__VU * 13 + __ITER) % 40);
  const amountUsd = tokenAmount * 100;

  const createRes = http.post(
    `${BASE_URL}/v1/investments`,
    JSON.stringify({
      tradeDealId: dealId,
      tokenAmount,
      amountUsd,
    }),
    {
      ...jwtHeaders(token),
      tags: { name: 'CreateInvestment', flow: 'investment_creation' },
    },
  );

  check(createRes, {
    'investment request handled': (r) => r.status >= 200 && r.status < 500,
    'investment response returns JSON': (r) => {
      try {
        r.json();
        return true;
      } catch {
        return false;
      }
    },
  });

  if (createRes.status === 200 || createRes.status === 201) {
    const body = createRes.json();
    const investmentId = body?.investment?.id;

    if (investmentId) {
      const fundRes = http.post(
        `${BASE_URL}/v1/investments/${investmentId}/fund`,
        JSON.stringify({
          investorWalletAddress: `G${Math.random().toString(36).slice(2, 34).padEnd(56, 'X')}`,
          signedXdr: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        }),
        {
          ...jwtHeaders(token),
          tags: { name: 'FundEscrow', flow: 'investment_creation' },
        },
      );

      check(fundRes, {
        'fund escrow request handled': (r) => r.status >= 200 && r.status < 500,
      });
    }
  }

  sleep(Math.random() * 0.6 + 0.2);
}

export function escrow_payout(data) {
  const token = data.traderToken;
  if (!token) {
    return;
  }

  const dealId = data.payoutDealId || data.dealId;

  const payoutRes = http.post(
    `${BASE_URL}/v1/shipments/milestones`,
    JSON.stringify({
      trade_deal_id: dealId,
      milestone: 'importer',
      notes: 'Load test: escrow payout validation before production deploy',
      latitude: 0.0,
      longitude: 0.0,
    }),
    {
      ...jwtHeaders(token),
      tags: { name: 'RecordImporterMilestone', flow: 'escrow_payout' },
    },
  );

  check(payoutRes, {
    'payout trigger handled': (r) => r.status >= 200 && r.status < 500,
    'payout response includes status or data': (r) => {
      try {
        const body = r.json();
        return !!(body?.id || body?.status || body?.message || body?.error);
      } catch {
        return false;
      }
    },
  });

  sleep(Math.random() * 0.8 + 0.25);
}
