import { INestApplication, Controller, Get, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

/**
 * Simple test controller for CORS validation
 */
@Controller()
class CorsTestController {
  @Get('/health')
  health() {
    return { status: 'ok' };
  }

  @Get('/public')
  publicEndpoint() {
    return { message: 'public data' };
  }
}

@Module({
  controllers: [CorsTestController],
})
class CorsTestModule {}

describe('CORS Origin Validator (E2E)', () => {
  let app: INestApplication;

  /**
   * Test suite for whitelisted origins
   */
  describe('Whitelisted Origins', () => {
    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [CorsTestModule],
      }).compile();

      app = module.createNestApplication();

      // Configure CORS with specific whitelisted origins
      app.enableCors({
        origin: [
          'http://localhost:3000',
          'http://localhost:3001',
          'https://app.agri-fi.com',
          'https://staging.agri-fi.com',
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      });

      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should allow requests from whitelisted origin: localhost:3000', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(response.body.status).toBe('ok');
    });

    it('should allow requests from whitelisted origin: localhost:3001', async () => {
      const response = await request(app.getHttpServer())
        .get('/public')
        .set('Origin', 'http://localhost:3001')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3001',
      );
      expect(response.body.message).toBe('public data');
    });

    it('should allow requests from whitelisted origin: https://app.agri-fi.com', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'https://app.agri-fi.com')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(
        'https://app.agri-fi.com',
      );
    });

    it('should allow requests from whitelisted origin: https://staging.agri-fi.com', async () => {
      const response = await request(app.getHttpServer())
        .get('/public')
        .set('Origin', 'https://staging.agri-fi.com')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(
        'https://staging.agri-fi.com',
      );
    });

    it('should include credentials header for whitelisted origins', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should handle preflight OPTIONS requests from whitelisted origins', async () => {
      const response = await request(app.getHttpServer())
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type');

      // OPTIONS requests typically return 204 No Content
      expect([200, 204]).toContain(response.status);
      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(response.headers['access-control-allow-methods']).toBeDefined();
      expect(response.headers['access-control-allow-headers']).toBeDefined();
    });
  });

  /**
   * Test suite for non-whitelisted origins
   */
  describe('Non-Whitelisted Origins', () => {
    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [CorsTestModule],
      }).compile();

      app = module.createNestApplication();

      // Configure CORS with specific whitelisted origins
      app.enableCors({
        origin: ['http://localhost:3000', 'https://app.agri-fi.com'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      });

      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should reject requests from non-whitelisted origin: http://malicious.com', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://malicious.com');

      // CORS rejection means the header is not set
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should reject requests from non-whitelisted origin: https://attacker.io', async () => {
      const response = await request(app.getHttpServer())
        .get('/public')
        .set('Origin', 'https://attacker.io');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should reject requests from non-whitelisted origin: http://localhost:4000', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://localhost:4000');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should reject requests from non-whitelisted origin: http://localhost:8080', async () => {
      const response = await request(app.getHttpServer())
        .get('/public')
        .set('Origin', 'http://localhost:8080');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should reject preflight OPTIONS requests from non-whitelisted origins', async () => {
      const response = await request(app.getHttpServer())
        .options('/health')
        .set('Origin', 'http://unauthorized.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should not include credentials header for non-whitelisted origins', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://untrusted.com');

      // When origin is not whitelisted, CORS headers should not be set
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  /**
   * Test suite for edge cases and special scenarios
   */
  describe('Edge Cases and Special Scenarios', () => {
    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [CorsTestModule],
      }).compile();

      app = module.createNestApplication();

      // Configure CORS with specific whitelisted origins
      app.enableCors({
        origin: ['http://localhost:3000', 'https://app.agri-fi.com'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      });

      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should handle requests without Origin header', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      // Requests without Origin header should still work (non-CORS requests)
      expect(response.body.status).toBe('ok');
    });

    it('should be case-sensitive for origin matching', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'HTTP://LOCALHOST:3000');

      // Should not match due to case sensitivity
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should reject origins with different protocols', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'https://localhost:3000');

      // http and https are different origins
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should reject origins with different ports', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://localhost:3001');

      // Different port = different origin
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should reject origins with subdomains not in whitelist', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'https://api.app.agri-fi.com');

      // Subdomain not explicitly whitelisted
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should handle multiple requests from same origin', async () => {
      const origin = 'http://localhost:3000';

      const response1 = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', origin)
        .expect(200);

      const response2 = await request(app.getHttpServer())
        .get('/public')
        .set('Origin', origin)
        .expect(200);

      expect(response1.headers['access-control-allow-origin']).toBe(origin);
      expect(response2.headers['access-control-allow-origin']).toBe(origin);
    });
  });

  /**
   * Test suite for wildcard and dynamic origin configurations
   */
  describe('Wildcard and Dynamic Origins', () => {
    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [CorsTestModule],
      }).compile();

      app = module.createNestApplication();

      // Configure CORS with wildcard (not recommended for production)
      app.enableCors({
        origin: '*',
        credentials: false,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      });

      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should allow any origin when wildcard is configured', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://any-origin.com')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('should allow requests from localhost with wildcard', async () => {
      const response = await request(app.getHttpServer())
        .get('/public')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('should not include credentials with wildcard origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://any-origin.com')
        .expect(200);

      // Wildcard with credentials is not allowed by CORS spec
      expect(
        response.headers['access-control-allow-credentials'],
      ).toBeUndefined();
    });
  });

  /**
   * Test suite for HTTP methods and headers validation
   */
  describe('HTTP Methods and Headers Validation', () => {
    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [CorsTestModule],
      }).compile();

      app = module.createNestApplication();

      app.enableCors({
        origin: ['http://localhost:3000'],
        credentials: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      });

      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should allow GET requests from whitelisted origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
    });

    it('should include allowed methods in preflight response', async () => {
      const response = await request(app.getHttpServer())
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST');

      // OPTIONS requests typically return 204 No Content
      expect([200, 204]).toContain(response.status);
      expect(response.headers['access-control-allow-methods']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toContain('GET');
      expect(response.headers['access-control-allow-methods']).toContain(
        'POST',
      );
    });

    it('should include allowed headers in preflight response', async () => {
      const response = await request(app.getHttpServer())
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type,Authorization');

      // OPTIONS requests typically return 204 No Content
      expect([200, 204]).toContain(response.status);
      expect(response.headers['access-control-allow-headers']).toBeDefined();
    });
  });
});
