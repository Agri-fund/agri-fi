import {
  Controller,
  Get,
  Delete,
  UseGuards,
  Request,
  Query,
  BadRequestException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('users')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly tradeDealsService: TradeDealsService,
  ) {}

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
  async getUserDeals(
    @Request() req: AuthRequest,
    @Query('role') requestedRole?: string,
  ) {
    const { id: userId, role } = req.user;

    if (role !== 'farmer' && role !== 'trader') {
      throw new ForbiddenException(
        'Only farmers and traders can access deals endpoint',
      );
    }

    if (
      requestedRole &&
      requestedRole !== 'farmer' &&
      requestedRole !== 'trader'
    ) {
      throw new BadRequestException('role must be either farmer or trader');
    }

    if (requestedRole && requestedRole !== role) {
      throw new ForbiddenException(
        'Requested role does not match authenticated user role',
      );
    }

    return this.tradeDealsService.findByUser(userId, role);
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

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'GDPR Right to be Forgotten — anonymize and soft-delete account',
    description:
      'Verifies no active trade deals or unresolved investments exist, ' +
      'anonymizes PII (email, wallet, company details), invalidates all ' +
      'sessions, then soft-deletes the user record.',
  })
  @ApiResponse({ status: 200, description: 'Account anonymized and scheduled for deletion' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Active deals or unresolved investments exist' })
  deleteAccount(@Request() req: AuthRequest) {
    return this.usersService.deleteAccount(req.user.id);
  }
}
