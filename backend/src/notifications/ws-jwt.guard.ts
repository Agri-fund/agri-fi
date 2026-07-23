import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

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
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      extractBearer(client.handshake.headers.authorization);

    if (!token) {
      throw new WsException('Unauthorized');
    }

    try {
      client.data.user = this.jwtService.verify(token);
      return true;
    } catch {
      throw new WsException('Unauthorized');
    }
  }
}
