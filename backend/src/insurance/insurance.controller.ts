import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { User } from '../auth/entities/user.entity';
import { CreateInsuranceClaimDto } from './dto/create-insurance-claim.dto';
import { CreateInsuranceQuoteDto } from './dto/create-insurance-quote.dto';
import { InsuranceEventDto } from './dto/insurance-event.dto';
import { InsuranceProviderWebhookDto } from './dto/insurance-provider-webhook.dto';
import { InsuranceService } from './insurance.service';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('insurance')
@Controller({ path: 'insurance', version: '1' })
export class InsuranceController {
  constructor(private readonly insuranceService: InsuranceService) {}

  @Post('deals/:dealId/quotes')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Generate and compare insurance quotes for a deal' })
  @ApiParam({ name: 'dealId', description: 'Trade deal UUID' })
  async createQuotes(
    @Request() req: AuthRequest,
    @Param('dealId') dealId: string,
    @Body() dto: CreateInsuranceQuoteDto,
  ) {
    return this.insuranceService.compareQuotes(req.user, dealId, dto);
  }

  @Post('quotes/:quoteId/issue')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Issue a policy from an unexpired provider quote' })
  async issuePolicy(
    @Request() req: AuthRequest,
    @Param('quoteId') quoteId: string,
  ) {
    return this.insuranceService.issuePolicy(req.user, quoteId);
  }

  @Post('policies/:policyId/anchor')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Retry Stellar anchoring for an issued policy' })
  async anchorPolicy(
    @Request() req: AuthRequest,
    @Param('policyId') policyId: string,
  ) {
    return this.insuranceService.anchorPolicy(req.user, policyId);
  }

  @Post('policies/:policyId/claims')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Submit a claim against an active policy' })
  async createClaim(
    @Request() req: AuthRequest,
    @Param('policyId') policyId: string,
    @Body() dto: CreateInsuranceClaimDto,
  ) {
    return this.insuranceService.createClaim(req.user, policyId, dto);
  }

  @Get('analytics')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get claim and payout analytics (admin only)' })
  async getAnalytics(@Request() req: AuthRequest) {
    return this.insuranceService.getAnalytics(req.user);
  }

  @Post('events')
  @ApiOperation({
    summary: 'Trigger claims from a signed covered-event notification',
  })
  async triggerClaims(
    @Body() dto: InsuranceEventDto,
    @Headers('x-insurance-signature') signature: string,
  ) {
    return this.insuranceService.triggerClaims(dto, signature);
  }

  @Post('providers/:providerId/webhook')
  @ApiOperation({
    summary: 'Receive signed provider claim decisions and payout confirmations',
  })
  async providerWebhook(
    @Param('providerId') providerId: string,
    @Body() dto: InsuranceProviderWebhookDto,
    @Headers('x-insurance-signature') signature: string,
  ) {
    return this.insuranceService.handleProviderWebhook(
      providerId,
      dto,
      signature,
    );
  }
}
