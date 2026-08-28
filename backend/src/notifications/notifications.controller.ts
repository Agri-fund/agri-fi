import {
  Controller,
  Get,
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

@ApiTags('notifications')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Version('1')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

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
}
