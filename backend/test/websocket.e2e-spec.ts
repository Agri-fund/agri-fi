import { INestApplication, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { io } from 'socket.io-client';
import { NotificationsGateway } from '../src/notifications/notifications.gateway';
import { WsJwtGuard } from '../src/notifications/ws-jwt.guard';

const JWT_SECRET = 'websocket-e2e-secret';

@Module({
  imports: [
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    }),
  ],
  providers: [NotificationsGateway, WsJwtGuard],
})
class WebsocketTestModule {}

type ConnectResult = { connected: true } | { connected: false; error: Error };

function tryConnect(
  baseUrl: string,
  auth: { token?: string },
): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const socket = io(`${baseUrl}/notifications`, {
      auth,
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
    });

    const finish = (result: ConnectResult) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.close();
      resolve(result);
    };

    const timer = setTimeout(
      () =>
        finish({ connected: false, error: new Error('Connection timeout') }),
      5000,
    );

    socket.on('connect', () => finish({ connected: true }));
    socket.on('connect_error', (error: Error) =>
      finish({ connected: false, error }),
    );
  });
}

describe('WebSocket authentication (E2E)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [WebsocketTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? 0 : address.port;
    baseUrl = `http://127.0.0.1:${port}`;

    jwtService = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects connections when the token is invalid', async () => {
    const result = await tryConnect(baseUrl, { token: 'not-a-valid-jwt' });

    expect(result).toMatchObject({ connected: false });
    if (result.connected === false) {
      expect(result.error.message).toMatch(/unauthorized|jwt|invalid/i);
    }
  });

  it('rejects connections when no token is provided', async () => {
    const result = await tryConnect(baseUrl, {});

    expect(result).toMatchObject({ connected: false });
    if (result.connected === false) {
      expect(result.error.message).toMatch(/unauthorized/i);
    }
  });

  it('accepts connections when a valid JWT is provided', async () => {
    const token = jwtService.sign({
      sub: 'a0000000-0000-0000-0000-000000000003',
      email: 'investor@agri-fi.demo',
      role: 'investor',
      tokenVersion: 0,
    });

    const result = await tryConnect(baseUrl, { token });

    expect(result).toEqual({ connected: true });
  });
});
