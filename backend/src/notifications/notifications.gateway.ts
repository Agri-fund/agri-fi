import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OptionalWsJwtGuard } from './ws-jwt.guard';
import { NotificationsService } from './notifications.service';
/** Rooms that unauthenticated sockets are allowed to join. */
export const PUBLIC_ROOMS = ['deal_funding_progress'] as const;

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/notifications',
})
@UseGuards(OptionalWsJwtGuard)
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server: Server;

  private readonly connectionsByUser = new Map<string, number>();
  private readonly maxConnectionsPerUser = Number(process.env.WS_MAX_CONNECTIONS_PER_USER ?? 10);

  private getUserId(client: Socket): string | undefined {
    const user = (client as any).data?.user ?? (client as any).user;
    const userId = user?.id ?? user?.sub;
    return userId ? String(userId) : undefined;
  }

  constructor(
    private readonly jwtService: JwtService,
    private readonly wsJwtGuard: OptionalWsJwtGuard,
    private readonly notificationsService: NotificationsService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      const client = socket as Socket;
      const token = this.wsJwtGuard.extractToken(client);

      if (!token) {
        // Anonymous visitor: allow the connection but mark it unauthenticated.
        this.wsJwtGuard.markAnonymous(client);
        return next();
      }

      try {
        this.wsJwtGuard.verifyAndStore(client, token);
        next();
      } catch {
        // Invalid/expired token: fall back to anonymous instead of disconnecting.
        this.wsJwtGuard.markAnonymous(client);
        next();
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId = this.getUserId(client);
    if (userId) {
      const current = this.connectionsByUser.get(userId) ?? 0;
      if (current >= this.maxConnectionsPerUser) {
        client.emit('rate_limit_error', { message: 'Too many active notification connections' });
        client.disconnect(true);
        return;
      }
      this.connectionsByUser.set(userId, current + 1);
      void client.join(`user:${userId}`);
      this.logger.debug(`Authenticated client connected: ${client.id}`);
      const unreadCount = await this.notificationsService.getUnreadCount(
        userId,
      );
      client.emit('handshake_response', { unreadCount });
      client.emit('unread_count', { count: unreadCount });
    } else {
      this.logger.debug(`Anonymous client connected: ${client.id}`);
      // Anonymous sockets only get public rooms.
      for (const room of PUBLIC_ROOMS) {
        client.join(room);
      }
      client.emit('handshake_response', { unreadCount: 0, anonymous: true });
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = this.getUserId(client);
    if (userId) {
      const current = this.connectionsByUser.get(userId) ?? 1;
      if (current <= 1) this.connectionsByUser.delete(userId);
      else this.connectionsByUser.set(userId, current - 1);
    }
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Subscribe a socket to a room. Sensitive rooms require authentication;
   * anonymous sockets are rejected server-side.
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, room: string): void {
    const isPublic = (PUBLIC_ROOMS as readonly string[]).includes(room);
    const userId = this.getUserId(client);

    if (!isPublic && !userId) {
      client.emit('auth_error', { message: 'Authentication required' });
      return;
    }

    if (room.startsWith('user:') && room !== `user:${userId}`) {
      client.emit('auth_error', { message: 'Cannot subscribe to another user room' });
      return;
    }

    client.join(room);
  }

  publishDealStatusChanged(payload: { dealId: string; status: string; title?: string; message?: string }) {
    this.server?.to(`deal:${payload.dealId}`).emit('deal.status_changed', payload);
    this.server?.to('deal_funding_progress').emit('deal.status_changed', payload);
  }

  publishMilestoneReached(payload: { dealId: string; milestone: string; title?: string; message?: string }) {
    this.server?.to(`deal:${payload.dealId}`).emit('milestone.reached', payload);
  }

  publishInvestmentConfirmed(payload: { userId: string; dealId: string; investmentId: string; title?: string; message?: string }) {
    this.server?.to(`user:${payload.userId}`).emit('investment.confirmed', payload);
  }

  publishEscrowReleased(payload: { userId: string; dealId: string; amountUsd?: number; title?: string; message?: string }) {
    this.server?.to(`user:${payload.userId}`).emit('escrow.released', payload);
  }
}
