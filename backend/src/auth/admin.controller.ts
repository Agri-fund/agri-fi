import {
  Controller,
  Post,
  Param,
  UseGuards,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('admin')
@Controller('admin')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth('jwt')
export class AdminController {
  constructor(private readonly authService: AuthService) {}

  @Post('kyc/:userId/approve')
  @ApiOperation({ summary: 'Approve a user KYC submission' })
  @ApiResponse({ status: 200, description: 'KYC approved' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'User or submission not found' })
  async approveKyc(@Request() req: AuthRequest, @Param('userId') userId: string) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
    return this.authService.approveKyc(userId);
  }
}
