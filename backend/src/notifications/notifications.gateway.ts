import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard, WS_AUTH_ERROR_CODE } from './ws-jwt.guard';

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

  constructor(
    private readonly jwtService: JwtService,
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly notificationsService: NotificationsService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      const token = this.wsJwtGuard.extractToken(socket as Socket);

      if (!token) {
        (socket as Socket).disconnect();
        return next(new Error('Unauthorized'));
      }

      try {
        this.wsJwtGuard.verifyAndStore(socket as Socket, token);
        next();
      } catch {
        (socket as Socket).disconnect();
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    this.logger.debug(`Client connected: ${client.id}`);
    const user = (client as any).user;
    if (user?.id) {
      const unreadCount = await this.notificationsService.getUnreadCount(
        user.id,
      );
      client.emit('handshake_response', { unreadCount });
      client.emit('unread_count', { count: unreadCount });
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  afterInitMessageValidation(server: Server): void {
    server.use((socket, next) => {
      const client = socket as Socket;
      const token = this.wsJwtGuard.extractToken(client);
      if (!token) {
        client.emit('auth_error', { message: 'Token missing' });
        client.disconnect(true);
        return next(new Error('Unauthorized'));
      }
      try {
        this.wsJwtGuard.verifyAndStore(client, token);
        next();
      } catch {
        return next(new Error('Unauthorized'));
      }
    });
  }
}
