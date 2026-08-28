import {
  Controller,
  Get,
  Patch,
  Query,
  Body,
  UseGuards,
  Request,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiProperty,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { DealDigestService } from '../trade-deals/deal-digest.service';

class UpdatePreferencesDto {
  @ApiProperty({
    description:
      'IANA timezone used to schedule the weekly digest (e.g. Africa/Nairobi)',
    required: false,
    example: 'Africa/Nairobi',
  })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({
    description: 'Preferred language for emails and UI',
    required: false,
    enum: ['en', 'es', 'fr', 'pt', 'sw'],
  })
  @IsIn(['en', 'es', 'fr', 'pt', 'sw'])
  @IsOptional()
  preferredLanguage?: string;

  @ApiProperty({
    description: 'Opt in/out of the weekly deal digest email (#892)',
    required: false,
  })
  @IsOptional()
  emailDigestEnabled?: boolean;
}

/**
 * Email preference endpoints backing the weekly digest (#892):
 * - GET /users/unsubscribe — public, tokenized one-click opt-out
 * - PATCH /users/me/preferences — authenticated preference updates
 */
@ApiTags('users')
@Controller('users')
export class EmailPreferencesController {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly digestService: DealDigestService,
  ) {}

  /**
   * Public one-click unsubscribe linked from every digest footer.
   * The token is an HMAC of the user id — no authentication required.
   */
  @Get('unsubscribe')
  @ApiOperation({
    summary: 'Unsubscribe from the weekly deal digest (public, tokenized)',
  })
  @ApiResponse({ status: 200, description: 'Unsubscribed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid unsubscribe link' })
  async unsubscribe(
    @Query('userId') userId: string,
    @Query('token') token: string,
  ): Promise<{ message: string }> {
    if (
      !userId ||
      !token ||
      !this.digestService.verifyUnsubscribeToken(userId, token)
    ) {
      throw new UnauthorizedException('Invalid or expired unsubscribe link.');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('Unknown user.');

    user.emailDigestEnabled = false;
    await this.userRepo.save(user);

    return {
      message: 'You have been unsubscribed from the weekly deal digest.',
    };
  }

  @Patch('me/preferences')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Update email preferences: timezone, preferred language, digest opt-out',
  })
  @ApiResponse({ status: 200, description: 'Updated preferences' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async updatePreferences(
    @Request() req: { user: User },
    @Body() dto: UpdatePreferencesDto,
  ): Promise<{
    timezone: string | null;
    preferredLanguage: string;
    emailDigestEnabled: boolean;
  }> {
    const user = await this.userRepo.findOne({ where: { id: req.user.id } });
    if (!user) throw new BadRequestException('User not found.');

    if (dto.timezone !== undefined) {
      // Reject obviously invalid IANA zones early; the digest scheduler has a
      // UTC fallback but explicit validation gives users better feedback.
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: dto.timezone });
        user.timezone = dto.timezone;
      } catch {
        throw new BadRequestException('Invalid IANA timezone.');
      }
    }
    if (dto.preferredLanguage !== undefined) {
      user.preferredLanguage = dto.preferredLanguage;
    }
    if (dto.emailDigestEnabled !== undefined) {
      user.emailDigestEnabled = dto.emailDigestEnabled;
    }

    await this.userRepo.save(user);

    return {
      timezone: user.timezone ?? null,
      preferredLanguage: user.preferredLanguage ?? 'en',
      emailDigestEnabled: user.emailDigestEnabled !== false,
    };
  }
}
