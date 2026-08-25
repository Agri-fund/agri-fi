import {
  Controller,
  Get,
  Query,
  Redirect,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { EmailSequenceService } from './email-sequence.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('email-sequence')
@Controller()
export class EmailSequenceController {
  constructor(private readonly sequenceService: EmailSequenceService) {}

  // ── Public: one-click unsubscribe ─────────────────────────────────────────

  /**
   * GET /email-sequence/unsubscribe?token=<base64url>
   *
   * CAN-SPAM / GDPR one-click unsubscribe. Sets emailSequenceUnsubscribed=true
   * on the user and cancels any pending drip steps.
   * Redirects to a confirmation page on the frontend app.
   */
  @Get('email-sequence/unsubscribe')
  @ApiOperation({ summary: 'One-click unsubscribe from investor drip email sequence' })
  @ApiQuery({ name: 'token', description: 'Base64url-encoded user ID', required: true })
  @HttpCode(HttpStatus.FOUND)
  @Redirect()
  async unsubscribe(@Query('token') token: string) {
    try {
      await this.sequenceService.unsubscribe(token);
      return { url: '/unsubscribed?status=ok' };
    } catch {
      return { url: '/unsubscribed?status=invalid' };
    }
  }

  // ── Admin: sequence status view ───────────────────────────────────────────

  /**
   * GET /admin/email-sequences
   *
   * Returns a paginated list of all investor drip sequence rows.
   * Admin only.
   */
  @Get('admin/email-sequences')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all investor email sequence rows (admin)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  async listAllSequences(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(limit, 200);
    return this.sequenceService.listAllSequences({ page, limit: safeLimit });
  }

  /**
   * GET /admin/email-sequences/:userId
   *
   * Returns the drip sequence status for a specific investor.
   * Admin only.
   */
  @Get('admin/email-sequences/:userId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get drip sequence status for a specific investor (admin)' })
  @ApiParam({ name: 'userId', description: 'Investor user UUID' })
  async getSequenceForUser(@Param('userId') userId: string) {
    return this.sequenceService.getSequenceStatus(userId);
  }
}
