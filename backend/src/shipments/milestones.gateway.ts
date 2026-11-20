import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { websocketCorsOptions } from '../common/websocket-cors';

@Injectable()
@WebSocketGateway({
  namespace: '/milestones',
  cors: websocketCorsOptions,
})
export class MilestonesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private activeRooms = new Map<string, Set<string>>();

  constructor(private readonly logger: PinoLogger) {
    (this.logger as any).setContext(MilestonesGateway.name);
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Milestone client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Milestone client disconnected: ${client.id}`);
    this.activeRooms.forEach((clients) => clients.delete(client.id));
  }

  @SubscribeMessage('join_deal')
  handleJoinDeal(client: Socket, data: { dealId: string; userId: string }) {
    const room = `deal-${data.dealId}`;
    client.join(room);

    if (!this.activeRooms.has(room)) {
      this.activeRooms.set(room, new Set());
    }
    this.activeRooms.get(room).add(client.id);

    this.logger.debug(`User ${data.userId} joined deal room: ${room}`);

    // Broadcast user joined
    this.server.to(room).emit('user_joined', { userId: data.userId });
  }

  @SubscribeMessage('leave_deal')
  handleLeaveDeal(client: Socket, data: { dealId: string; userId: string }) {
    const room = `deal-${data.dealId}`;
    client.leave(room);
    this.activeRooms.get(room)?.delete(client.id);

    this.logger.debug(`User ${data.userId} left deal room: ${room}`);

    // Broadcast user left
    this.server.to(room).emit('user_left', { userId: data.userId });
  }

  // Emit milestone status update to deal room
  emitMilestoneUpdate(dealId: string, milestone: any) {
    const room = `deal-${dealId}`;
    this.server.to(room).emit('milestone_updated', milestone);
    this.logger.debug(`Milestone update emitted to room: ${room}`);
  }

  // Emit comment added to deal room
  emitCommentAdded(dealId: string, comment: any) {
    const room = `deal-${dealId}`;
    this.server.to(room).emit('comment_added', comment);
    this.logger.debug(`Comment emitted to room: ${room}`);
  }

  // Emit verification to deal room
  emitVerificationAdded(dealId: string, verification: any) {
    const room = `deal-${dealId}`;
    this.server.to(room).emit('verification_added', verification);
    this.logger.debug(`Verification emitted to room: ${room}`);
  }
}
