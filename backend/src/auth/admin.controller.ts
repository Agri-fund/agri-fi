import {
  Controller,
  Post,
  Param,
  UseGuards,
  ForbiddenException,
  Request,
  Body,
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
import { ApiBody } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

class UpdateUserRoleDto {
  @IsIn(['farmer', 'trader', 'investor', 'company_admin', 'admin'])
  role: 'farmer' | 'trader' | 'investor' | 'company_admin' | 'admin';
}

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

  @Post('users/:userId/role')
  @ApiOperation({ summary: 'Update a user role and invalidate old tokens' })
  @ApiBody({ type: UpdateUserRoleDto })
  async updateUserRole(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
    return this.authService.updateUserRole(userId, dto.role);
  }
}
