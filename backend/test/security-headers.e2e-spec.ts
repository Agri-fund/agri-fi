import { INestApplication, Controller, Get, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { applySecurityHeaders } from '../src/common/middleware/security-headers.middleware';

@Controller()
class RootController {
  @Get()
  root() {
    return { status: 'ok' };
  }
}

@Module({ controllers: [RootController] })
class TestAppModule {}

describe('Security Headers (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = module.createNestApplication();
    app.use(applySecurityHeaders);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets Strict-Transport-Security (HSTS) header', async () => {
    const response = await request(app.getHttpServer()).get('/');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['strict-transport-security']).toContain(
      'max-age=31536000',
    );
    expect(response.headers['strict-transport-security']).toContain(
      'includeSubDomains',
    );
  });

  it('sets Content-Security-Policy (CSP) header', async () => {
    const response = await request(app.getHttpServer()).get('/');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
  });

  it('sets X-Content-Type-Options header to nosniff', async () => {
    const response = await request(app.getHttpServer()).get('/');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options header to DENY', async () => {
    const response = await request(app.getHttpServer()).get('/');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('sets Referrer-Policy header', async () => {
    const response = await request(app.getHttpServer()).get('/');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});
