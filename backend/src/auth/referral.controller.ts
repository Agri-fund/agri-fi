import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ReferralService } from './referral.service';
import { User } from './entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('referrals')
@ApiBearerAuth('jwt')
@Version('1')
@Controller('users/me/referrals')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Get referral stats for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Referral stats with code and referral list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getReferralStats(@Request() req: AuthRequest) {
    return this.referralService.getReferralStats(req.user.id);
  }

  @Post('track/:code')
  @ApiOperation({ summary: 'Track a referral link click' })
  @ApiParam({ name: 'code', description: 'Referral code' })
  @ApiResponse({ status: 200, description: 'Click tracked' })
  @ApiResponse({ status: 404, description: 'Invalid referral code' })
  async trackClick(@Param('code') code: string) {
    return this.referralService.trackClick(code);
  }
}
