import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsJwtGuard, WS_AUTH_ERROR_CODE } from './ws-jwt.guard';

function makeContext(handshake: any = {}): ExecutionContext {
  const client = {
    handshake,
    data: {} as any,
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  return {
    switchToWs: () => ({
      getClient: () => client,
    }),
  } as any;
}

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;
  let jwtService: JwtService;

  beforeEach(() => {
    jwtService = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1h' } });
    guard = new WsJwtGuard(jwtService);
  });

  it('rejects when no token is provided', () => {
    const ctx = makeContext({ auth: {}, headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(/Unauthorized/);
  });

  it('rejects an invalid token', () => {
    const ctx = makeContext({ auth: { token: 'bad-token' }, headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(/Unauthorized/);
  });

  it('accepts a valid token and stores payload', () => {
    const token = jwtService.sign({ sub: 'user-1', email: 'a@b.com' });
    const ctx = makeContext({ auth: { token }, headers: {} });
    expect(guard.canActivate(ctx)).toBe(true);
    const client = ctx.switchToWs().getClient() as any;
    expect(client.data.user.sub).toBe('user-1');
  });

  it('rejects an expired token and emits auth_error', () => {
    const token = jwtService.sign(
      { sub: 'user-1' },
      { expiresIn: '0s' },
    );
    const ctx = makeContext({ auth: { token }, headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(/Token expired/);
    const client = ctx.switchToWs().getClient() as any;
    expect(client.emit).toHaveBeenCalledWith('auth_error', { message: 'Token expired' });
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('extracts token from Authorization header when auth.token is absent', () => {
    const token = jwtService.sign({ sub: 'user-2' });
    const ctx = makeContext({ auth: {}, headers: { authorization: `Bearer ${token}` } });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
