import {
  Controller,
  Delete,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  Request,
  HttpCode,
  Inject,
} from '@nestjs/common';
import {
  CACHE_MANAGER,
  CacheInterceptor,
  CacheTTL,
} from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { TradeDealsService } from './trade-deals.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { KycGuard } from '../auth/kyc.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { CreateTradeDealDto } from './dto/create-trade-deal.dto';
import { DealCoFarmersService } from './deal-co-farmers.service';
import { DealDeploymentService } from './deal-deployment.service';
import {
  AcceptCoFarmerInvitationDto,
  InviteCoFarmerDto,
} from './dto/co-farmer.dto';
import { DealCoFarmer } from './entities/deal-co-farmer.entity';
import { ActivityFeedService } from './activity-feed.service';
import { ActivityFeedResponseDto } from './dto/activity-feed.dto';

import { TradeDealAccessRequest, TradeDealsGuard } from './trade-deals.guard';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('trade-deals')
@Controller({ version: '1', path: 'trade-deals' })
export class TradeDealsController {
  constructor(
    private readonly tradeDealsService: TradeDealsService,
    private readonly dealCoFarmersService: DealCoFarmersService,
    private readonly dealDeploymentService: DealDeploymentService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard, KycGuard)
  @Roles('trader', 'farmer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Create a draft trade deal (trader or farmer, KYC required)',
  })
  @ApiResponse({ status: 201, description: 'Trade deal created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Role or KYC requirement not met' })
  async createDeal(
    @Request() req: AuthRequest,
    @Body() dto: CreateTradeDealDto,
  ): Promise<TradeDeal> {
    // Farmers self-list: they are both the farmer and the acting trader
    if (req.user.role === 'farmer') {
      dto.farmer_id = req.user.id;
      dto.trader_id = req.user.id;
    }
    return this.tradeDealsService.createDeal(req.user.id, dto);
  }

  @Post(':id/publish')
  @HttpCode(202)
  @UseGuards(AuthGuard('jwt'), RolesGuard, KycGuard)
  @Roles('trader')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Publish a draft trade deal (async token issuance)',
  })
  @ApiResponse({
    status: 202,
    description: 'Deal publish request accepted, token issuance in progress',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Role or KYC requirement not met' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  @ApiResponse({
    status: 422,
    description:
      'Deal not in draft status, missing documents, or co-farmers not accepted/KYC verified',
  })
  async publishDeal(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ): Promise<TradeDeal> {
    // #891 KYC gate — a deal cannot go live until every invited co-farmer has
    // accepted the invitation and passed KYC verification.
    await this.dealCoFarmersService.assertAllCoFarmersVerified(id);

    const deal = await this.tradeDealsService.publishDeal(id, req.user.id);
    await this.cacheManager.stores[0].reset();
    return deal;
  }

  // ── Admin approval + on-chain deployment (#830) ────────────────────────────

  @Post(':id/approve')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Approve a draft deal and deploy its FarmCampaign contract via ProjectFactory (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Deal approved; campaign contract deployed and deal is open',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  @ApiResponse({
    status: 422,
    description: 'Deal not in draft or deployment failed',
  })
  async approveDeal(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ): Promise<TradeDeal> {
    const deal = await this.dealDeploymentService.approveDeal(id, req.user.id);
    await this.cacheManager.stores[0].reset();
    return deal;
  }

  // ── Co-investment endpoints (#891) ─────────────────────────────────────────

  @Post(':id/co-farmers')
  @UseGuards(AuthGuard('jwt'), RolesGuard, KycGuard)
  @Roles('trader', 'farmer')
  @HttpCode(201)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Invite an existing farmer user as a co-farmer on a deal (lead farmer or trader)',
  })
  @ApiResponse({ status: 201, description: 'Invitation created and emailed' })
  @ApiResponse({
    status: 400,
    description: 'Portion exceeds 100% or invalid target',
  })
  @ApiResponse({
    status: 403,
    description: 'Not the lead farmer or assigned trader',
  })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async inviteCoFarmer(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: InviteCoFarmerDto,
  ): Promise<DealCoFarmer> {
    return this.dealCoFarmersService.inviteCoFarmer(id, req.user.id, dto);
  }

  @Get(':id/co-farmers')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'List co-farmers for a trade deal' })
  @ApiResponse({
    status: 200,
    description: 'Co-farmer list (invitation tokens hidden)',
  })
  async listCoFarmers(@Param('id') id: string): Promise<DealCoFarmer[]> {
    const records = await this.dealCoFarmersService.listCoFarmers(id);
    // Never expose invitation tokens through the API.
    return records.map((r) => ({ ...r, invitationToken: undefined }));
  }

  @Post(':id/co-farmers/accept')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('farmer')
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Accept a co-farmer invitation using the emailed token',
  })
  @ApiResponse({ status: 200, description: 'Invitation accepted' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 404, description: 'No invitation found' })
  async acceptCoFarmer(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: AcceptCoFarmerInvitationDto,
  ): Promise<DealCoFarmer> {
    return this.dealCoFarmersService.acceptInvitation(
      id,
      req.user.id,
      dto.token,
    );
  }

  @Post(':id/co-farmers/decline')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('farmer')
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Decline a co-farmer invitation using the emailed token',
  })
  @ApiResponse({ status: 200, description: 'Invitation declined' })
  @ApiResponse({ status: 400, description: 'Invalid token' })
  @ApiResponse({ status: 404, description: 'No invitation found' })
  async declineCoFarmer(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: AcceptCoFarmerInvitationDto,
  ): Promise<DealCoFarmer> {
    return this.dealCoFarmersService.declineInvitation(
      id,
      req.user.id,
      dto.token,
    );
  }

  @Delete(':id/co-farmers/:farmerId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('trader', 'farmer')
  @HttpCode(204)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Remove a co-farmer from a deal before delivery (lead farmer or trader)',
  })
  @ApiResponse({ status: 204, description: 'Co-farmer removed' })
  @ApiResponse({
    status: 403,
    description: 'Not the lead farmer or assigned trader',
  })
  @ApiResponse({
    status: 404,
    description: 'Trade deal or co-farmer not found',
  })
  async removeCoFarmer(
    @Param('id') id: string,
    @Param('farmerId') farmerId: string,
    @Request() req: AuthRequest,
  ): Promise<void> {
    await this.dealCoFarmersService.removeCoFarmer(id, farmerId, req.user.id);
  }

  @Get()
  @Throttle({ marketplace: { limit: 60, ttl: 60000 } })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30000)
  @ApiOperation({ summary: 'List open trade deals (marketplace)' })
  @ApiQuery({ name: 'commodity', required: false, example: 'Cocoa' })
  @ApiQuery({ name: 'country', required: false, example: 'Nigeria' })
  @ApiQuery({ name: 'region', required: false, example: 'Ashanti' })
  @ApiQuery({ name: 'minAmount', required: false, example: 250 })
  @ApiQuery({ name: 'maxAmount', required: false, example: 5000 })
  @ApiQuery({ name: 'minRoi', required: false, example: 10 })
  @ApiQuery({ name: 'maxRoi', required: false, example: 50 })
  @ApiQuery({ name: 'duration', required: false, example: '3-6 months' })
  @ApiQuery({ name: 'riskRating', required: false, example: 'Medium' })
  @ApiQuery({ name: 'status', required: false, example: 'almost funded' })
  @ApiQuery({ name: 'sortBy', required: false, example: 'newest' })
  @ApiQuery({ name: 'q', required: false, example: 'cocoa cooperative' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 12 })
  @ApiResponse({ status: 200, description: 'Paginated list of open deals' })
  async findOpen(
    @Query() query: Record<string, string | undefined> = {},
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    return this.tradeDealsService.findOpen({
      commodity: query.commodity,
      country: query.country,
      region: query.region,
      minAmount: query.minAmount ? Number(query.minAmount) : undefined,
      maxAmount: query.maxAmount ? Number(query.maxAmount) : undefined,
      minRoi: query.minRoi ? Number(query.minRoi) : undefined,
      maxRoi: query.maxRoi ? Number(query.maxRoi) : undefined,
      duration: query.duration as any,
      riskRating: query.riskRating as any,
      status: query.status as any,
      sortBy: query.sortBy as any,
      q: query.q,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  }

  @Get(':id')
  @Throttle({ marketplace: { limit: 60, ttl: 60000 } })
  @UseGuards(OptionalJwtGuard, TradeDealsGuard)
  @ApiOperation({
    summary: 'Get trade deal detail including documents and milestones',
  })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  @ApiResponse({ status: 200, description: 'Trade deal detail' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async findOne(
    @Param('id') id: string,
    @Request() req: TradeDealAccessRequest,
  ): Promise<any> {
    return this.tradeDealsService.findOne(id, req.tradeDealAccess);
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard('jwt'), RolesGuard, KycGuard)
  @Roles('trader')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Cancel a trade deal and trigger clawbacks (trader only, KYC required)',
  })
  @ApiResponse({ status: 200, description: 'Trade deal canceled successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Role or KYC requirement not met' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async cancelDeal(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ): Promise<TradeDeal> {
    const deal = await this.tradeDealsService.cancelDeal(id, req.user.id);
    // Invalidate the marketplace listing cache so cancelled deals disappear
    // from the active-deals list immediately (#743).
    await this.cacheManager.stores[0].reset();
    return deal;
  }

  // ── Activity Feed (Issue #863) ────────────────────────────────────────────

  /**
   * GET /v1/trade-deals/:id/activity?cursor=...&limit=20
   *
   * Returns a cursor-paginated activity feed for the given deal.
   * Events are sourced from shipment_milestones and system_audit_logs.
   * Investor amounts are anonymised for non-admin viewers.
   */
  @Get(':id/activity')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({
    summary: 'Get activity feed for a trade deal (cursor-paginated)',
  })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (max 50, default 20)',
  })
  @ApiResponse({ status: 200, description: 'Activity feed events' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async getActivityFeed(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Request() req?: any,
  ): Promise<ActivityFeedResponseDto> {
    const isAdmin =
      req?.user?.role === 'admin' || req?.user?.role === 'company_admin';
    return this.activityFeedService.getFeed(id, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      isAdmin,
    });
  }
}
