import {
  Controller,
  Get,
  Patch,
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
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { User } from '../../auth/entities/user.entity';
import { NotificationPreferencesService } from './notification-preferences.service';

class UpdateNotificationPreferenceDto {
  @IsString()
  @MaxLength(50)
  notificationType!: string;

  @IsBoolean()
  @IsOptional()
  emailEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  pushEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  inAppEnabled?: boolean;
}

@ApiTags('users')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Version('1')
@Controller('users')
export class NotificationPreferencesController {
  constructor(
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  @Get('me/notification-preferences')
  @ApiOperation({ summary: 'Get notification preferences for all notification types' })
  @ApiResponse({ status: 200, description: 'List of notification preferences' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPreferences(@Request() req: { user: User }) {
    return this.preferencesService.getPreferences(req.user.id);
  }

  @Patch('me/notification-preferences')
  @ApiOperation({ summary: 'Update notification preferences for a notification type' })
  @ApiResponse({ status: 200, description: 'Updated notification preference' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updatePreference(
    @Request() req: { user: User },
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.preferencesService.updatePreference(req.user.id, dto);
  }
}
