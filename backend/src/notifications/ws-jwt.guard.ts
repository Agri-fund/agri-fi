import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

export const WS_AUTH_ERROR_CODE = 4001;

function extractBearer(authorization: unknown): string | undefined {
  if (typeof authorization !== 'string') {
    return undefined;
  }
  const [scheme, token] = authorization.split(' ');
  return scheme === 'Bearer' ? token : undefined;
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();
    const token = this.extractToken(client);

    if (!token) {
      throw new WsException('Unauthorized');
    }

    return this.verifyAndStore(client, token);
  }

  extractToken(client: Socket): string | undefined {
    return (
      (client.handshake.auth?.token as string | undefined) ??
      extractBearer(client.handshake.headers.authorization)
    );
  }

  verifyAndStore(client: Socket, token: string): boolean {
    try {
      const payload = this.jwtService.verify(token);
      client.data.user = payload;
      return true;
    } catch (err: any) {
      if (err?.name === 'TokenExpiredError') {
        client.emit('auth_error', { message: 'Token expired' });
        client.disconnect(true);
        throw new WsException('Token expired');
      }
      throw new WsException('Unauthorized');
    }
  }
}
