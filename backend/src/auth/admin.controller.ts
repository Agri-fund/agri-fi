import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  Body,
  Query,
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
import { Roles, RolesGuard } from './roles.guard';

class UpdateUserRoleDto {
  @IsIn(['farmer', 'trader', 'investor', 'company_admin', 'admin'])
  role: 'farmer' | 'trader' | 'investor' | 'company_admin' | 'admin';
}

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('admin')
@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@ApiBearerAuth('jwt')
export class AdminController {
  constructor(private readonly authService: AuthService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users (admin only)' })
  @ApiResponse({ status: 200, description: 'List of users' })
  async listUsers(@Query('page') page = '1', @Query('limit') limit = '100') {
    return this.authService.listUsers(parseInt(page), parseInt(limit));
  }

  @Post('kyc/:userId/approve')
  @ApiOperation({ summary: 'Approve a user KYC submission' })
  @ApiResponse({ status: 200, description: 'KYC approved' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'User or submission not found' })
  async approveKyc(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
  ) {
    return this.authService.approveKyc(userId);
  }

  @Post('kyc/:id/approve-corporate')
  @ApiOperation({ summary: 'Approve a corporate KYC submission by id' })
  @ApiResponse({ status: 200, description: 'Corporate KYC approved' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  async approveCorporateKyc(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    return this.authService.approveCorporateKycSubmission(id);
  }

  @Post('users/:userId/role')
  @ApiOperation({ summary: 'Update a user role and invalidate old tokens' })
  @ApiBody({ type: UpdateUserRoleDto })
  async updateUserRole(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.authService.updateUserRole(userId, dto.role);
  }
}
