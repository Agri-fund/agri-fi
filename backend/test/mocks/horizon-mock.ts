import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Horizon } from '@stellar/stellar-sdk';
import { AddressInfo } from 'net';

/** Default account id used by mock fixtures. */
export const MOCK_ACCOUNT_ID =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/** Default 64-char hex transaction hash used by mock fixtures. */
export const MOCK_TX_HASH =
  'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890';

/** Env var tests should set so Horizon clients target the local mock server. */
export const HORIZON_MOCK_ENV_VAR = 'STELLAR_HORIZON_URL';

/**
 * Returns the mock Horizon base URL when running under Jest / NODE_ENV=test.
 * Falls back to the real testnet URL outside test environments.
 */
export function resolveHorizonUrlForTests(
  mockBaseUrl: string,
  fallback = 'https://horizon-testnet.stellar.org',
): string {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return mockBaseUrl;
  }
  return process.env[HORIZON_MOCK_ENV_VAR] ?? fallback;
}

/** Horizon client configured for the local mock server (http + allowHttp). */
export function createHorizonTestClient(baseUrl: string): Horizon.Server {
  return new Horizon.Server(baseUrl, { allowHttp: true });
}

/** Horizon-compatible account resource JSON. */
export function mockAccountResponse(
  accountId: string = MOCK_ACCOUNT_ID,
  overrides: Record<string, unknown> = {},
) {
  return {
    _links: {
      self: { href: `/accounts/${accountId}` },
      transactions: { href: `/accounts/${accountId}/transactions` },
      operations: { href: `/accounts/${accountId}/operations` },
      payments: { href: `/accounts/${accountId}/payments` },
    },
    id: accountId,
    account_id: accountId,
    sequence: '123456789',
    subentry_count: 0,
    thresholds: {
      low_threshold: 0,
      med_threshold: 0,
      high_threshold: 0,
    },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    balances: [
      {
        balance: '10000.0000000',
        buying_liabilities: '0.0000000',
        selling_liabilities: '0.0000000',
        asset_type: 'native',
      },
    ],
    signers: [
      {
        weight: 1,
        key: accountId,
        type: 'ed25519_public_key',
      },
    ],
    data: {},
    ...overrides,
  };
}

/** Horizon-compatible single transaction resource JSON. */
export function mockTransactionResponse(
  txHash: string = MOCK_TX_HASH,
  overrides: Record<string, unknown> = {},
) {
  return {
    _links: {
      self: { href: `/transactions/${txHash}` },
      account: {
        href: `/accounts/${MOCK_ACCOUNT_ID}`,
      },
      effects: { href: `/transactions/${txHash}/effects` },
      operations: { href: `/transactions/${txHash}/operations` },
    },
    id: txHash,
    paging_token: '47021635458048',
    hash: txHash,
    ledger: 100,
    created_at: '2024-01-15T10:30:00Z',
    source_account: MOCK_ACCOUNT_ID,
    source_account_sequence: '123456789',
    fee_account: MOCK_ACCOUNT_ID,
    fee_charged: '100',
    max_fee: '100',
    operation_count: 1,
    envelope_xdr: 'AAAAAgAAAAD...',
    result_xdr: 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=',
    result_meta_xdr: 'AAAAAgAAAAIAAAAD...',
    fee_meta_xdr: 'AAAAAgAAAAM...',
    memo_type: 'none',
    signatures: ['signature'],
    successful: true,
    ...overrides,
  };
}

/** Horizon-compatible paginated transaction history for an account. */
export function mockTransactionHistoryResponse(
  accountId: string = MOCK_ACCOUNT_ID,
  records: Record<string, unknown>[] = [mockTransactionResponse()],
) {
  return {
    _links: {
      self: { href: `/accounts/${accountId}/transactions` },
      next: {
        href: `/accounts/${accountId}/transactions?cursor=47021635458048`,
      },
      prev: {
        href: `/accounts/${accountId}/transactions?cursor=47021635458047&order=desc`,
      },
    },
    _embedded: {
      records,
    },
    records,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse, resource: string): void {
  sendJson(res, 404, {
    type: 'https://stellar.org/horizon-errors/not_found',
    title: 'Resource Missing',
    status: 404,
    detail: `The resource at the url requested was not found. /${resource}`,
  });
}

function readRequestPath(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', 'http://horizon-mock.local');
  return url.pathname;
}

export interface HorizonMockServer {
  baseUrl: string;
  port: number;
  setAccountResponse: (
    accountId: string,
    body: Record<string, unknown>,
  ) => void;
  setTransactionResponse: (
    txHash: string,
    body: Record<string, unknown>,
  ) => void;
  setTransactionHistoryResponse: (
    accountId: string,
    body: Record<string, unknown>,
  ) => void;
  close: () => Promise<void>;
}

export interface HorizonMockServerOptions {
  accounts?: Record<string, Record<string, unknown>>;
  transactions?: Record<string, Record<string, unknown>>;
  transactionHistories?: Record<string, Record<string, unknown>>;
}

/**
 * Starts a lightweight local HTTP server that mimics Horizon account and
 * transaction endpoints for deterministic tests (no public testnet calls).
 */
export function startHorizonMockServer(
  options: HorizonMockServerOptions = {},
): Promise<HorizonMockServer> {
  const accounts = new Map<string, Record<string, unknown>>(
    Object.entries(options.accounts ?? {}).map(([id, body]) => [id, body]),
  );
  const transactions = new Map<string, Record<string, unknown>>(
    Object.entries(options.transactions ?? {}).map(([hash, body]) => [
      hash,
      body,
    ]),
  );
  const transactionHistories = new Map<string, Record<string, unknown>>(
    Object.entries(options.transactionHistories ?? {}).map(([id, body]) => [
      id,
      body,
    ]),
  );

  if (!accounts.has(MOCK_ACCOUNT_ID)) {
    accounts.set(MOCK_ACCOUNT_ID, mockAccountResponse());
  }
  if (!transactions.has(MOCK_TX_HASH)) {
    transactions.set(MOCK_TX_HASH, mockTransactionResponse());
  }
  if (!transactionHistories.has(MOCK_ACCOUNT_ID)) {
    transactionHistories.set(MOCK_ACCOUNT_ID, mockTransactionHistoryResponse());
  }

  const server = createServer((req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { status: 405, title: 'Method Not Allowed' });
      return;
    }

    const path = readRequestPath(req);

    const accountMatch = path.match(/^\/accounts\/([^/]+)$/);
    if (accountMatch) {
      const accountId = decodeURIComponent(accountMatch[1]);
      const body = accounts.get(accountId);
      if (!body) {
        notFound(res, `accounts/${accountId}`);
        return;
      }
      sendJson(res, 200, body);
      return;
    }

    const txMatch = path.match(/^\/transactions\/([^/]+)$/);
    if (txMatch) {
      const txHash = decodeURIComponent(txMatch[1]);
      const body = transactions.get(txHash);
      if (!body) {
        notFound(res, `transactions/${txHash}`);
        return;
      }
      sendJson(res, 200, body);
      return;
    }

    const historyMatch = path.match(/^\/accounts\/([^/]+)\/transactions$/);
    if (historyMatch) {
      const accountId = decodeURIComponent(historyMatch[1]);
      const body = transactionHistories.get(accountId);
      if (!body) {
        notFound(res, `accounts/${accountId}/transactions`);
        return;
      }
      sendJson(res, 200, body);
      return;
    }

    notFound(res, path.replace(/^\//, ''));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        port: address.port,
        setAccountResponse: (accountId, body) => {
          accounts.set(accountId, body);
        },
        setTransactionResponse: (txHash, body) => {
          transactions.set(txHash, body);
        },
        setTransactionHistoryResponse: (accountId, body) => {
          transactionHistories.set(accountId, body);
        },
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
}
