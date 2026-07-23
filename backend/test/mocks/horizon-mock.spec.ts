import {
  createHorizonTestClient,
  HORIZON_MOCK_ENV_VAR,
  MOCK_ACCOUNT_ID,
  MOCK_TX_HASH,
  mockAccountResponse,
  mockTransactionHistoryResponse,
  mockTransactionResponse,
  resolveHorizonUrlForTests,
  startHorizonMockServer,
} from './horizon-mock';
import { Keypair } from '@stellar/stellar-sdk';

describe('Horizon mock server', () => {
  let mockServer: Awaited<ReturnType<typeof startHorizonMockServer>>;

  beforeEach(async () => {
    mockServer = await startHorizonMockServer();
  });

  afterEach(async () => {
    await mockServer.close();
  });

  it('routes account queries to the mock server in test environments', async () => {
    const horizonUrl = resolveHorizonUrlForTests(mockServer.baseUrl);
    expect(horizonUrl).toBe(mockServer.baseUrl);

    const server = createHorizonTestClient(horizonUrl);
    const account = await server.loadAccount(MOCK_ACCOUNT_ID);

    expect(account.accountId()).toBe(MOCK_ACCOUNT_ID);
    expect(account.sequenceNumber()).toBe('123456789');
    expect(account.balances[0].balance).toBe('10000.0000000');
  });

  it('routes single transaction queries to the mock server', async () => {
    const server = createHorizonTestClient(mockServer.baseUrl);
    const tx = await server.transactions().transaction(MOCK_TX_HASH).call();

    expect(tx.hash).toBe(MOCK_TX_HASH);
    expect(tx.successful).toBe(true);
  });

  it('routes account transaction history queries to the mock server', async () => {
    const server = createHorizonTestClient(mockServer.baseUrl);
    const history = await server
      .transactions()
      .forAccount(MOCK_ACCOUNT_ID)
      .limit(10)
      .call();

    expect(history.records).toHaveLength(1);
    expect(history.records[0].hash).toBe(MOCK_TX_HASH);
  });

  it('returns Horizon-style 404 for unknown accounts', async () => {
    const server = createHorizonTestClient(mockServer.baseUrl);

    await expect(
      server.loadAccount(Keypair.random().publicKey()),
    ).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it('allows overriding fixture responses per test', async () => {
    const customAccountId = Keypair.random().publicKey();
    mockServer.setAccountResponse(
      customAccountId,
      mockAccountResponse(customAccountId, { sequence: '999' }),
    );
    mockServer.setTransactionResponse(
      MOCK_TX_HASH,
      mockTransactionResponse(MOCK_TX_HASH, { successful: false }),
    );
    mockServer.setTransactionHistoryResponse(
      customAccountId,
      mockTransactionHistoryResponse(customAccountId, []),
    );

    const server = createHorizonTestClient(mockServer.baseUrl);
    const account = await server.loadAccount(customAccountId);
    const tx = await server.transactions().transaction(MOCK_TX_HASH).call();
    const history = await server
      .transactions()
      .forAccount(customAccountId)
      .call();

    expect(account.sequenceNumber()).toBe('999');
    expect(tx.successful).toBe(false);
    expect(history.records).toHaveLength(0);
  });

  it('uses STELLAR_HORIZON_URL when set outside Jest worker context', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalWorkerId = process.env.JEST_WORKER_ID;
    const originalHorizonUrl = process.env[HORIZON_MOCK_ENV_VAR];

    delete process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    process.env[HORIZON_MOCK_ENV_VAR] = 'http://127.0.0.1:9999';

    expect(resolveHorizonUrlForTests('http://127.0.0.1:1')).toBe(
      'http://127.0.0.1:9999',
    );

    process.env.NODE_ENV = originalNodeEnv;
    if (originalWorkerId) {
      process.env.JEST_WORKER_ID = originalWorkerId;
    } else {
      delete process.env.JEST_WORKER_ID;
    }
    if (originalHorizonUrl) {
      process.env[HORIZON_MOCK_ENV_VAR] = originalHorizonUrl;
    } else {
      delete process.env[HORIZON_MOCK_ENV_VAR];
    }
  });
});
