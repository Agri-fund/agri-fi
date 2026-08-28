import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AchievementService } from './achievement.service';
import { BadgeType } from './entities/achievement.entity';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('achievements')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Version('1')
@Controller()
export class AchievementController {
  constructor(private readonly achievementService: AchievementService) {}

  @Get('users/me/achievements')
  @ApiOperation({ summary: 'Get earned achievement badges for current user' })
  async getMyAchievements(@Request() req: { user: { id: string } }) {
    return this.achievementService.getUserAchievements(req.user.id);
  }

  @Post('admin/achievements/grant')
  @UseGuards(RolesGuard)
  @Roles('admin', 'company_admin')
  @ApiOperation({ summary: 'Admin manually grant an achievement badge' })
  async adminGrant(
    @Request() req: { user: { id: string } },
    @Body() body: { userId: string; badgeType: BadgeType; reason: string },
  ) {
    return this.achievementService.adminGrantBadge(
      body.userId,
      body.badgeType,
      req.user.id,
      body.reason,
    );
  }

  @Delete('admin/achievements/revoke/:userId/:badgeType')
  @UseGuards(RolesGuard)
  @Roles('admin', 'company_admin')
  @ApiOperation({ summary: 'Admin manually revoke an achievement badge' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiParam({ name: 'badgeType', description: 'Badge type string' })
  async adminRevoke(
    @Param('userId') userId: string,
    @Param('badgeType') badgeType: BadgeType,
    @Body('reason') reason: string,
  ) {
    await this.achievementService.adminRevokeBadge(userId, badgeType, reason);
    return { success: true };
  }
}
