import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { createConnection, getConnection } from 'typeorm';
import { StellarMock } from '../../mocks/stellarMock';

let app: INestApplication;
let server: any;
let stellarMock: StellarMock;

beforeAll(async () => {
  // Start mock Stellar service
  stellarMock = new StellarMock();
  await stellarMock.start();

  // Setup test DB (use environment variables for Docker PostgreSQL)
  process.env.TYPEORM_CONNECTION = 'postgres';
  process.env.TYPEORM_HOST = 'localhost';
  process.env.TYPEORM_PORT = '5433'; // CI will map container port
  process.env.TYPEORM_USERNAME = 'test';
  process.env.TYPEORM_PASSWORD = 'test';
  process.env.TYPEORM_DATABASE = 'agri_fi_test';
  process.env.TYPEORM_SYNCHRONIZE = 'true';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
  await stellarMock.stop();
  const conn = getConnection();
  await conn.close();
});

function registerUser() {
  return request(server)
    .post('/users/register')
    .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
    .expect(201)
    .then(res => res.body);
}

async function completeKYC(token: string) {
  return request(server)
    .post('/kyc/complete')
    .set('Authorization', `Bearer ${token}`)
    .send({ documentId: 'doc-123' })
    .expect(200);
}

async function createDeal(token: string) {
  return request(server)
    .post('/deals')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Test Deal', amount: 5000, currency: 'USD' })
    .expect(201)
    .then(res => res.body);
}

async function publishDeal(token: string, dealId: string) {
  return request(server)
    .post(`/deals/${dealId}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
}

async function createInvestment(token: string, dealId: string) {
  return request(server)
    .post('/investments')
    .set('Authorization', `Bearer ${token}`)
    .send({ dealId, amount: 1000 })
    .expect(201)
    .then(res => res.body);
}

async function submitXDR(token: string, investmentId: string) {
  return request(server)
    .post(`/investments/${investmentId}/submit-tx`)
    .set('Authorization', `Bearer ${token}`)
    .send({ xdr: 'SIGNED_XDR_PLACEHOLDER' })
    .expect(200);
}

describe('Critical Investment Flow E2E', () => {
  it('should complete the full investment lifecycle', async () => {
    const user = await registerUser();
    const token = user.accessToken;
    await completeKYC(token);
    const deal = await createDeal(token);
    await publishDeal(token, deal.id);
    const investment = await createInvestment(token, deal.id);
    await submitXDR(token, investment.id);

    // Verify investment status
    const invRes = await request(server)
      .get(`/investments/${investment.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(invRes.body.status).toBe('confirmed');

    // Verify deal totalInvested updated
    const dealRes = await request(server)
      .get(`/deals/${deal.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(dealRes.body.totalInvested).toBeGreaterThanOrEqual(1000);
  }, 30000);
});
