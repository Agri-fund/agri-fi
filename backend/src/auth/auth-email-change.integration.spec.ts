import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';

import { AppModule } from '../app.module';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailChangeCleanupService } from './email-change-cleanup.service';

describe('Email change flow (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let notificationsService: { sendEmail: jest.Mock };
  let jwtService: JwtService;
  let cleanupService: EmailChangeCleanupService;

  const originalEmail = 'original@example.com';
  const newEmail = 'new-address@example.com';
  let userId: string;
  let authToken: string;

  beforeAll(async () => {
    notificationsService = { sendEmail: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NotificationsService)
      .useValue(notificationsService)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    dataSource = moduleRef.get<DataSource>(DataSource);
    userRepository = moduleRef.get<Repository<User>>(getRepositoryToken(User));
    jwtService = moduleRef.get<JwtService>(JwtService);
    cleanupService = moduleRef.get<EmailChangeCleanupService>(EmailChangeCleanupService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    notificationsService.sendEmail.mockClear();

    // Clean up any prior test users
    await dataSource.query('DELETE FROM "user" WHERE email LIKE $1 OR email_pending LIKE $1', [
      '%@example.com',
    ]);

    const user = userRepository.create({
      email: originalEmail,
      passwordHash: 'hashed-password',
      displayName: 'Test User',
      emailVerified: true,
    });
    const saved = await userRepository.save(user);
    userId = saved.id;
    authToken = jwtService.sign({ sub: saved.id, email: saved.email });
  });

  const authHeader = () => ({ Authorization: `Bearer ${authToken}` });

  describe('PATCH /users/me with a new email', () => {
    it('stores emailPending and does not change the live email', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set(authHeader())
        .send({ email: newEmail })
        .expect(200);

      expect(res.body.email).toBe(originalEmail);

      const stored = await userRepository.findOneByOrFail({ id: userId });
      expect(stored.email).toBe(originalEmail);
      expect(stored.emailPending).toBe(newEmail);
      expect(stored.emailVerificationToken).toBeTruthy();
      expect(stored.emailVerificationTokenExpiresAt).toBeInstanceOf(Date);
    });

    it('sends a verification email to the pending address', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set(authHeader())
        .send({ email: newEmail })
        .expect(200);

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      const call = notificationsService.sendEmail.mock.calls[0][0];
      expect(call.to).toBe(newEmail);
      expect(call.subject).toMatch(/verify/i);
      expect(call.body).toMatch(/verify-email-change\?token=/);
    });

    it('does not send a verification email when the email is unchanged', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set(authHeader())
        .send({ email: originalEmail })
        .expect(200);

      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('GET /auth/verify-email-change', () => {
    it('swaps email and clears pending fields for a valid token', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set(authHeader())
        .send({ email: newEmail })
        .expect(200);

      const pending = await userRepository.findOneByOrFail({ id: userId });
      const token = pending.emailVerificationToken;
      expect(token).toBeTruthy();

      await request(app.getHttpServer())
        .get('/auth/verify-email-change')
        .query({ token })
        .expect(200);

      const updated = await userRepository.findOneByOrFail({ id: userId });
      expect(updated.email).toBe(newEmail);
      expect(updated.emailPending).toBeNull();
      expect(updated.emailVerificationToken).toBeNull();
      expect(updated.emailVerificationTokenExpiresAt).toBeNull();
    });

    it('notifies the old email address after confirmation', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set(authHeader())
        .send({ email: newEmail })
        .expect(200);

      const pending = await userRepository.findOneByOrFail({ id: userId });
      notificationsService.sendEmail.mockClear();

      await request(app.getHttpServer())
        .get('/auth/verify-email-change')
        .query({ token: pending.emailVerificationToken })
        .expect(200);

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      const call = notificationsService.sendEmail.mock.calls[0][0];
      expect(call.to).toBe(originalEmail);
      expect(call.subject).toMatch(/changed|updated/i);
    });

    it('rejects an expired token and clears pending fields', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set(authHeader())
        .send({ email: newEmail })
        .expect(200);

      const pending = await userRepository.findOneByOrFail({ id: userId });
      const token = pending.emailVerificationToken;

      // Force the token to be expired
      await userRepository.update(userId, {
        emailVerificationTokenExpiresAt: new Date(Date.now() - 1000),
      });

      await request(app.getHttpServer())
        .get('/auth/verify-email-change')
        .query({ token })
        .expect(400);

      const updated = await userRepository.findOneByOrFail({ id: userId });
      expect(updated.email).toBe(originalEmail);
      expect(updated.emailPending).toBeNull();
      expect(updated.emailVerificationToken).toBeNull();
      expect(updated.emailVerificationTokenExpiresAt).toBeNull();
    });

    it('rejects an unknown token', async () => {
      await request(app.getHttpServer())
        .get('/auth/verify-email-change')
        .query({ token: 'not-a-real-token' })
        .expect(400);
    });
  });

  describe('cleanup cron', () => {
    it('clears expired pending emails', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set(authHeader())
        .send({ email: newEmail })
        .expect(200);

      await userRepository.update(userId, {
        emailVerificationTokenExpiresAt: new Date(Date.now() - 1000),
      });

      await cleanupService.cleanupExpiredEmailChanges();

      const updated = await userRepository.findOneByOrFail({ id: userId });
      expect(updated.email).toBe(originalEmail);
      expect(updated.emailPending).toBeNull();
      expect(updated.emailVerificationToken).toBeNull();
      expect(updated.emailVerificationTokenExpiresAt).toBeNull();
    });

    it('leaves unexpired pending emails intact', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set(authHeader())
        .send({ email: newEmail })
        .expect(200);

      await cleanupService.cleanupExpiredEmailChanges();

      const updated = await userRepository.findOneByOrFail({ id: userId });
      expect(updated.email).toBe(originalEmail);
      expect(updated.emailPending).toBe(newEmail);
      expect(updated.emailVerificationToken).toBeTruthy();
    });
  });
});