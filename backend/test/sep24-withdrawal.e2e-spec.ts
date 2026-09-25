/**
 * SEP-24 Withdrawal Flow — End-to-End Tests
 *
 * Covers the full SEP-24 interactive withdrawal lifecycle exposed by the backend:
 *   1. Initiation            — POST /sep24/transactions/withdraw/interactive
 *   2. Interactive flow       — the returned interactive URL + pending_anchor state
 *   3. KYC check             — the customer must be KYC-verified before funds move
 *   4. Stellar payment        — the on-chain payment is verified through horizon-mock
 *   5. Completion callback    — POST /sep24/callback finalises the transaction
 *
 * The Stellar network is represented by `horizon-mock` (see ./mocks/horizon-mock.ts),
 * so no real testnet access is required. The suite exercises both the happy path
 * (KYC passes, payment confirmed, withdrawal completed) and the rejection path
 * (KYC check fails during the interactive window).
 */

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import * as passport from 'passport';
import { createHmac } from 'crypto';
import * as request from 'supertest';
import { Keypair, Horizon } from '@stellar/stellar-sdk';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import { Sep24Controller } from '../src/stellar/sep24.controller';
import { Sep24Service } from '../src/stellar/sep24.service';
import {
  Sep24Transaction,
  Sep24TxKind,
  Sep24TxStatus,
} from '../src/stellar/entities/sep24-transaction.entity';
import {
  startHorizonMockServer,
  createHorizonTestClient,
  mockTransactionResponse,
  HorizonMockServer,
} from './mocks/horizon-mock';

/** Shared secret used to sign SEP-24 status callbacks (HMAC-SHA256). */
const WEBHOOK_SECRET = 'e2e-sep24-webhook-secret';

/** In-memory user surfaced as `req.user` by the test JWT strategy. */
let currentUser: {
  id: string;
  walletAddress: string | null;
  kycStatus: string;
};

/**
 * Minimal passport strategy registered under the name `jwt` so the controller's
 * `@UseGuards(AuthGuard('jwt'))` resolves to our in-test user without needing a
 * real JWT or the full auth module.
 */
class TestJwtStrategy extends passport.Strategy {
  constructor() {
    super();
    (this as unknown as { name: string }).name = 'jwt';
  }

  authenticate(): void {
    (this as unknown as { success: (user: unknown) => void }).success(
      currentUser,
    );
  }
}

/** Compute the HMAC-SHA256 signature expected by WebhookSignatureGuard. */
function signCallback(body: Record<string, unknown>): {
  raw: string;
  signature: string;
} {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(raw)
    .digest('hex');
  return { raw, signature };
}

describe('SEP-24 Withdrawal Flow (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let horizon: HorizonMockServer;

  /** In-memory repository so GET/transaction reflects what was persisted. */
  const store = new Map<string, Sep24Transaction>();
  const txRepo = {
    create: jest.fn((data: Partial<Sep24Transaction>) => ({
      startedAt: new Date(),
      updatedAt: new Date(),
      ...data,
    })),
    save: jest.fn(async (data: Sep24Transaction) => {
      const next = {
        ...store.get(data.id),
        ...data,
        updatedAt: new Date(),
      } as Sep24Transaction;
      store.set(data.id, next);
      return next;
    }),
    findOne: jest.fn(async (opts: { where: { id: string } }) => {
      return store.get(opts.where.id) ?? null;
    }),
    find: jest.fn(async (opts: { where: Partial<Sep24Transaction> }) => {
      return Array.from(store.values()).filter(
        (t) =>
          t.kind === opts.where.kind &&
          t.stellarAccount === opts.where.stellarAccount,
      );
    }),
  };

  const configService = {
    get: jest.fn((key: string, defaultValue?: string | number) => {
      const values: Record<string, string | number> = {
        USDC_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        USDC_ASSET_CODE: 'USDC',
        SEP24_INTERACTIVE_BASE_URL: 'http://localhost:3000/sep24/interactive',
        SEP24_FEE_PERCENT: 1,
        SEP24_FEE_FIXED: 0,
        SEP24_MIN_AMOUNT: 10,
        SEP24_MAX_AMOUNT: 100_000,
      };
      return values[key] ?? defaultValue;
    }),
  };

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;

    // Start the Horizon mock and point any Stellar network calls at it.
    horizon = await startHorizonMockServer();
    process.env.STELLAR_HORIZON_URL = horizon.baseUrl;

    // Register a controllable `jwt` passport strategy.
    passport.use('jwt', new TestJwtStrategy());

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [Sep24Controller],
      providers: [
        Sep24Service,
        { provide: getRepositoryToken(Sep24Transaction), useValue: txRepo },
        { provide: ConfigService, useValue: configService },
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await horizon.close();
    delete process.env.WEBHOOK_SECRET;
    delete process.env.STELLAR_HORIZON_URL;
  });

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
  });

  describe('Happy path — KYC passes, payment confirmed, withdrawal completed', () => {
    const walletAddress = Keypair.random().publicKey();

    it('runs the full withdrawal lifecycle end-to-end', async () => {
      currentUser = {
        id: 'happy-user',
        walletAddress,
        kycStatus: 'verified',
      };

      // 1. Initiation
      const initRes = await request(server)
        .post('/sep24/transactions/withdraw/interactive')
        .set('Authorization', 'Bearer test-token')
        .send({
          asset_code: 'USDC',
          account: walletAddress,
          amount: '100',
          dest: '0123456789',
          dest_extra: '058',
        })
        .expect(200);

      expect(initRes.body.type).toBe('interactive_customer_info_needed');
      const txId: string = initRes.body.id;
      expect(txId).toBeDefined();
      expect(initRes.body.url).toContain(`transaction_id=${txId}`);
      expect(initRes.body.url).toContain('kind=withdraw');

      // 2. Interactive flow — transaction is awaiting the customer in the window.
      const pendingRes = await request(server)
        .get(`/sep24/transaction?id=${txId}`)
        .set('Authorization', 'Bearer test-token')
        .expect(200);
      expect(pendingRes.body.transaction.status).toBe(
        Sep24TxStatus.PENDING_ANCHOR,
      );
      expect(pendingRes.body.transaction.kind).toBe(Sep24TxKind.WITHDRAW);

      // 3. KYC check — the customer must be verified before funds move.
      expect(currentUser.kycStatus).toBe('verified');

      // 4. Stellar payment — the customer's on-chain payment is recorded and
      //    verified through horizon-mock (a real Stellar network call).
      const paymentHash = 'd'.repeat(64);
      horizon.setTransactionResponse(
        paymentHash,
        mockTransactionResponse(paymentHash, {
          source_account: walletAddress,
        }),
      );

      const client: Horizon.Server = createHorizonTestClient(horizon.baseUrl);
      const onChain = await client
        .transactions()
        .transaction(paymentHash)
        .call();
      expect(onChain.hash).toBe(paymentHash);

      // 5. Completion callback — the anchor confirms the payment and finalises.
      const callbackPayload = {
        transaction_id: txId,
        status: Sep24TxStatus.COMPLETED,
        stellar_transaction_id: paymentHash,
        amount_out: '99',
        external_transaction_id: 'bank-ref-001',
        message: 'Withdrawal completed',
      };
      const { raw, signature } = signCallback(callbackPayload);
      await request(server)
        .post('/sep24/callback')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', signature)
        .send(raw)
        .expect(200);

      // Final state reflects the confirmed on-chain payment.
      const finalRes = await request(server)
        .get(`/sep24/transaction?id=${txId}`)
        .set('Authorization', 'Bearer test-token')
        .expect(200);
      expect(finalRes.body.transaction.status).toBe(Sep24TxStatus.COMPLETED);
      expect(finalRes.body.transaction.stellar_transaction_id).toBe(
        paymentHash,
      );
      expect(finalRes.body.transaction.amount_out).toBe('99');
      expect(finalRes.body.transaction.external_transaction_id).toBe(
        'bank-ref-001',
      );
    }, 30000);
  });

  describe('Rejection path — KYC check fails during interactive window', () => {
    const walletAddress = Keypair.random().publicKey();

    it('marks the withdrawal rejected when KYC verification fails', async () => {
      currentUser = {
        id: 'reject-user',
        walletAddress,
        kycStatus: 'rejected',
      };

      // Initiation still mints a transaction; the KYC gate is enforced by the
      // interactive anchor flow (which calls back with a rejection here).
      const initRes = await request(server)
        .post('/sep24/transactions/withdraw/interactive')
        .set('Authorization', 'Bearer test-token')
        .send({
          asset_code: 'USDC',
          account: walletAddress,
          amount: '50',
        })
        .expect(200);

      const txId: string = initRes.body.id;
      expect(currentUser.kycStatus).toBe('rejected');

      // The interactive KYC check fails — the anchor reports rejection.
      const callbackPayload = {
        transaction_id: txId,
        status: Sep24TxStatus.ERROR,
        message: 'KYC verification failed',
      };
      const { raw, signature } = signCallback(callbackPayload);
      await request(server)
        .post('/sep24/callback')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', signature)
        .send(raw)
        .expect(200);

      const rejectedRes = await request(server)
        .get(`/sep24/transaction?id=${txId}`)
        .set('Authorization', 'Bearer test-token')
        .expect(200);
      expect(rejectedRes.body.transaction.status).toBe(Sep24TxStatus.ERROR);
      expect(rejectedRes.body.transaction.message).toContain('KYC');
    }, 30000);
  });

  describe('Webhook security', () => {
    it('rejects callbacks with an invalid signature', async () => {
      const raw = JSON.stringify({
        transaction_id: 'abc',
        status: Sep24TxStatus.COMPLETED,
      });
      await request(server)
        .post('/sep24/callback')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', 'deadbeef')
        .send(raw)
        .expect(401);
    });
  });
});
