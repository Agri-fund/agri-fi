import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { IpfsGatewayMonitorService } from './ipfs-gateway-monitor.service';

const mockHttpService = () => ({
  get: jest.fn(),
  post: jest.fn().mockReturnValue(of({ data: {} })),
});

const mockConfig = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string, defaultVal?: string) => overrides[key] ?? defaultVal),
});

describe('IpfsGatewayMonitorService', () => {
  let service: IpfsGatewayMonitorService;
  let http: ReturnType<typeof mockHttpService>;

  beforeEach(async () => {
    http = mockHttpService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpfsGatewayMonitorService,
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: mockConfig({
            IPFS_GATEWAYS:
              'https://gateway-a.example.com,https://gateway-b.example.com',
            SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test',
          }),
        },
      ],
    }).compile();

    service = module.get<IpfsGatewayMonitorService>(IpfsGatewayMonitorService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getActiveGateway', () => {
    it('returns the first configured gateway initially', () => {
      expect(service.getActiveGateway()).toBe('https://gateway-a.example.com');
    });
  });

  describe('checkGateways', () => {
    it('keeps primary gateway when it responds successfully', async () => {
      http.get.mockReturnValue(of({ data: Buffer.from('ok') }));

      await service.checkGateways();

      expect(service.getActiveGateway()).toBe('https://gateway-a.example.com');
      expect(http.post).not.toHaveBeenCalled(); // no rotation → no alert
    });

    it('rotates to secondary gateway when primary fails', async () => {
      // First call (primary) → error; second call (secondary) → success
      http.get
        .mockReturnValueOnce(throwError(() => new Error('timeout')))
        .mockReturnValue(of({ data: Buffer.from('ok') }));

      await service.checkGateways();

      expect(service.getActiveGateway()).toBe('https://gateway-b.example.com');
      // Rotation alert should have been sent
      expect(http.post).toHaveBeenCalledTimes(1);
      const [, payload] = http.post.mock.calls[0];
      expect(payload.content).toContain('Gateway Rotation');
    });

    it('sends an "all offline" alert when every gateway fails', async () => {
      http.get.mockReturnValue(throwError(() => new Error('timeout')));

      await service.checkGateways();

      expect(http.post).toHaveBeenCalledTimes(1);
      const [, payload] = http.post.mock.calls[0];
      expect(payload.content).toContain('offline');
    });

    it('does not send webhook when no webhook URL is configured', async () => {
      const noUrlModule = await Test.createTestingModule({
        providers: [
          IpfsGatewayMonitorService,
          { provide: HttpService, useValue: http },
          { provide: ConfigService, useValue: mockConfig({}) },
        ],
      }).compile();

      const svcNoUrl = noUrlModule.get<IpfsGatewayMonitorService>(
        IpfsGatewayMonitorService,
      );
      // Simulate all gateways failing
      http.get.mockReturnValue(throwError(() => new Error('offline')));

      await svcNoUrl.checkGateways();

      // post should not be called even though gateways failed
      expect(http.post).not.toHaveBeenCalled();
    });
  });
});
