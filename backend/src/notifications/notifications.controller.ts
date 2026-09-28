import {
  Controller,
  Get,
  Post,
  Patch,
  Query,
  Body,
  UseGuards,
  Request,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service';
import { PushNotificationService } from './push-notification.service';

@ApiTags('notifications')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushNotificationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get user notifications' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'unread', required: false, example: true })
  async getNotifications(
    @Request() req: { user: { id: string } },
    @Query('limit') limit?: string,
    @Query('unread') unread?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const isUnread = unread === 'true';
    return this.notificationsService.getUserNotifications(
      req.user.id,
      parsedLimit,
      isUnread,
    );
  }

  @Patch('mark-read')
  @ApiOperation({
    summary: 'Mark notifications as read (all or specific array of IDs)',
  })
  async markRead(
    @Request() req: { user: { id: string } },
    @Body() body: { ids?: string[] },
  ) {
    await this.notificationsService.markAsRead(req.user.id, body?.ids);
    const unreadCount = await this.notificationsService.getUnreadCount(
      req.user.id,
    );
    return { success: true, unreadCount };
  }

  @Post('push/subscribe')
  @ApiOperation({ summary: 'Register browser push notification subscription' })
  @ApiResponse({ status: 201, description: 'Push subscription stored successfully' })
  async subscribePush(
    @Request() req: { user: { id: string } },
    @Body()
    body: {
      endpoint: string;
      keys?: { p256dh?: string; auth?: string };
      eventTypes?: string[];
      userAgent?: string;
    },
  ) {
    const sub = await this.pushService.subscribe(req.user.id, body);
    return { success: true, subscriptionId: sub.id, eventTypes: sub.eventTypes };
  }

  @Post('push/unsubscribe')
  @ApiOperation({ summary: 'Unregister browser push notification subscription' })
  @ApiResponse({ status: 200, description: 'Push subscription removed successfully' })
  async unsubscribePush(
    @Request() req: { user: { id: string } },
    @Body() body: { endpoint: string },
  ) {
    const removed = await this.pushService.unsubscribe(req.user.id, body.endpoint);
    return { success: removed };
  }

  @Get('push/subscriptions')
  @ApiOperation({ summary: 'List user active push subscriptions' })
  async getPushSubscriptions(@Request() req: { user: { id: string } }) {
    return this.pushService.getUserSubscriptions(req.user.id);
  }
}
