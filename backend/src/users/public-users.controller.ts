import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { UsersService } from './users.service';

/**
 * Public (unauthenticated) user endpoints.
 * These routes intentionally omit the JWT guard since they expose
 * only non-PII public profile data.
 */
@ApiTags('users')
@Controller({ version: '1', path: 'users' })
export class PublicUsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /users/:id/public-profile
   *
   * Returns a public-safe profile for the given user.
   * Sensitive fields (email, phone, national ID, full name, etc.) are never
   * included. The wallet address is truncated to show first 4 + last 4 chars.
   * The reputation score is cached in Redis for 15 minutes.
   */
  @Get(':id/public-profile')
  @ApiOperation({
    summary: 'Get the public profile of a user',
    description:
      'Returns only non-PII fields. Reputation score is cached in Redis with a 15-minute TTL.',
  })
  @ApiParam({
    name: 'id',
    description: 'User UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Public user profile',
    schema: {
      example: {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        role: 'farmer',
        country: 'KE',
        kycStatus: 'verified',
        walletAddress: 'GDQP...G4W37',
        creditScore: 720,
        createdAt: '2024-01-15T10:30:00.000Z',
        dealsCompleted: 5,
        activeDeals: 2,
        reputationScore: 76,
        onTimeRepaymentRate: 0.95,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getPublicProfile(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
  }
}
