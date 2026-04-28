import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as nodemailer from 'nodemailer';

jest.mock('nodemailer');

describe('NotificationsService', () => {
  let service: NotificationsService;
  let configService: jest.Mocked<ConfigService>;
  let logger: jest.Mocked<PinoLogger>;
  let sendMailMock: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    configService = {
      get: jest.fn(),
    } as any;

    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    } as any;

    sendMailMock = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: sendMailMock,
    });
  });

  describe('when enabled', () => {
    beforeEach(async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NOTIFICATIONS_ENABLED') return 'true';
        if (key === 'SMTP_HOST') return 'localhost';
        if (key === 'SMTP_PORT') return '1025';
        if (key === 'EMAIL_FROM') return 'test@domain.com';
        return '';
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotificationsService,
          { provide: ConfigService, useValue: configService },
          { provide: PinoLogger, useValue: logger },
        ],
      }).compile();

      service = module.get<NotificationsService>(NotificationsService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should send email successfully', async () => {
      await service.sendEmail('user@test.com', 'Subject', 'Text');

      expect(sendMailMock).toHaveBeenCalledWith({
        from: 'test@domain.com',
        to: 'user@test.com',
        subject: 'Subject',
        text: 'Text',
        html: undefined,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ to: '***@test.com' }),
        expect.stringContaining('***@test.com'),
      );
    });

    it('should throw error when transport fails', async () => {
      const error = new Error('SMTP Error');
      sendMailMock.mockRejectedValue(error);

      await expect(
        service.sendEmail('user@test.com', 'Subject', 'Text'),
      ).rejects.toThrow('SMTP Error');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '***@test.com',
          error: 'SMTP Error',
        }),
        expect.stringContaining('***@test.com'),
      );
    });

    it('should sanitise SMTP auth details in error logs', async () => {
      const error = new Error(
        'Invalid login: 535 5.7.8 Error: authentication failed: AUTH LOGIN abc123def456',
      );
      sendMailMock.mockRejectedValue(error);

      await expect(
        service.sendEmail('user@test.com', 'Subject', 'Text'),
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('AUTH ***'),
        }),
        expect.any(String),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.not.stringContaining('abc123def456'),
        }),
        expect.any(String),
      );
    });
  });

  describe('when disabled', () => {
    beforeEach(async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NOTIFICATIONS_ENABLED') return 'false';
        return '';
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotificationsService,
          { provide: ConfigService, useValue: configService },
          { provide: PinoLogger, useValue: logger },
        ],
      }).compile();

      service = module.get<NotificationsService>(NotificationsService);
    });

    it('should only log and not send email', async () => {
      await service.sendEmail('user@test.com', 'Subject', 'Text');

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(sendMailMock).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ to: '***@test.com' }),
        expect.stringContaining('[Test Mode] Simulated sending email'),
      );
    });
  });
});
