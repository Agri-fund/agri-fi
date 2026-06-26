import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from './ws-jwt.guard';

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/notifications',
})
@UseGuards(WsJwtGuard)
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (typeof socket.handshake.headers.authorization === 'string'
          ? socket.handshake.headers.authorization.split(' ')[1]
          : undefined);

      if (!token) {
        socket.disconnect();
        return next(new Error('Unauthorized'));
      }

      try {
        socket.data.user = this.jwtService.verify(token);
        next();
      } catch {
        socket.disconnect();
        next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }
}
