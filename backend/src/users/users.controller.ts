import {
  Controller,
  Get,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('users')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated user's profile" })
  @ApiResponse({
    status: 200,
    description: 'Current user profile',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getCurrentUser(@Request() req: AuthRequest) {
    return this.usersService.getProfile(req.user.id);
  }

  @Get('me/deals')
  @ApiOperation({ summary: "Get the authenticated farmer/trader's deals" })
  @ApiResponse({
    status: 200,
    description: 'List of deals for the current user',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Investors cannot access this endpoint',
  })
  async getUserDeals(@Request() req: AuthRequest) {
    const { id, role } = req.user;
    if (role === 'investor') {
      throw new ForbiddenException('Investors cannot access deals endpoint');
    }
    return this.usersService.getUserDeals(id, role);
  }

  @Get('me/investments')
  @ApiOperation({ summary: "Get the authenticated investor's investments" })
  @ApiResponse({
    status: 200,
    description: 'List of investments for the current user',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Only investors can access this endpoint',
  })
  async getUserInvestments(@Request() req: AuthRequest) {
    const { id, role } = req.user;
    if (role !== 'investor') {
      throw new ForbiddenException(
        'Only investors can access investments endpoint',
      );
    }
    return this.usersService.getUserInvestments(id, role);
  }
}
