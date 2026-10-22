import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
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
  CacheKey,
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
import { KycGuard, RolesGuard, OptionalJwtGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateTradeDealDto } from './dto/create-trade-deal.dto';
import { DealCoFarmersService } from './deal-co-farmers.service';
import { DealDeploymentService } from './deal-deployment.service';
import {
  AcceptCoFarmerInvitationDto,
  InviteCoFarmerDto,
} from './dto/co-farmer.dto';
import { DealCoFarmer } from './entities/deal-co-farmer.entity';
import { ActivityFeedResponseDto } from './dto/activity-feed.dto';
import { ActivityFeedService } from './activity-feed.service';

import { TradeDealAccessRequest, TradeDealsGuard } from './trade-deals.guard';

import { EsgScoringService, EsgQuestionnaireDto } from './esg-scoring.service';
import { DealHealthService } from './deal-health.service';
import { RiskScoringService } from './risk-scoring.service';
import { marketplaceCacheKey, viewerIdOf } from './marketplace-cache-key';

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
    private readonly activityFeedService: ActivityFeedService,
    private readonly esgScoringService: EsgScoringService,
    private readonly dealHealthService: DealHealthService,
    private readonly riskScoringService: RiskScoringService,
    private readonly dealSuggestionsService: DealSuggestionsService,
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
    await (this.cacheManager.stores[0] as any).reset();
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
    await (this.cacheManager.stores[0] as any).reset();
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
  @UseGuards(OptionalJwtGuard)
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30000)
  @CacheKey(marketplaceCacheKey)
  @ApiOperation({
    summary: 'List open trade deals (marketplace)',
    description:
      'Send an access token to have each row carry the `watched` flag from #1003. The listing is cached per viewer.',
  })
  @ApiBearerAuth('jwt')
  @ApiQuery({ name: 'commodity', required: false, example: 'Cocoa' })
  @ApiQuery({ name: 'country', required: false, example: 'Nigeria' })
  @ApiQuery({ name: 'region', required: false, example: 'Ashanti' })
  @ApiQuery({ name: 'minAmount', required: false, example: 250 })
  @ApiQuery({ name: 'maxAmount', required: false, example: 5000 })
  @ApiQuery({ name: 'minRoi', required: false, example: 10 })
  @ApiQuery({ name: 'maxRoi', required: false, example: 50 })
  @ApiQuery({ name: 'duration', required: false, example: '3-6 months' })
  @ApiQuery({ name: 'riskRating', required: false, example: 'Medium' })
  @ApiQuery({ name: 'minEsgScore', required: false, example: 70 })
  @ApiQuery({ name: 'esgRating', required: false, example: 'AA' })
  @ApiQuery({ name: 'status', required: false, example: 'almost funded' })
  @ApiQuery({ name: 'sortBy', required: false, example: 'newest' })
  @ApiQuery({ name: 'q', required: false, example: 'cocoa cooperative' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 12 })
  @ApiResponse({ status: 200, description: 'Paginated list of open deals' })
  async findOpen(
    @Query() query: Record<string, string | undefined> = {},
    @Request() req: Request,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    return this.tradeDealsService.findOpen({
      viewerId: viewerIdOf(req),
      commodity: query.commodity,
      country: query.country,
      region: query.region,
      minAmount: query.minAmount ? Number(query.minAmount) : undefined,
      maxAmount: query.maxAmount ? Number(query.maxAmount) : undefined,
      minRoi: query.minRoi ? Number(query.minRoi) : undefined,
      maxRoi: query.maxRoi ? Number(query.maxRoi) : undefined,
      duration: query.duration as any,
      riskRating: query.riskRating as any,
      minEsgScore: query.minEsgScore ? Number(query.minEsgScore) : undefined,
      esgRating: query.esgRating,
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
    await (this.cacheManager.stores[0] as any).reset();
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

  // ── ESG / Impact Scoring Endpoints (#1012) ────────────────────────────────

  @Post(':id/esg-questionnaire')
  @UseGuards(AuthGuard('jwt'), RolesGuard, KycGuard)
  @Roles('trader', 'farmer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Submit standardized ESG questionnaire for a trade deal',
  })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  @ApiResponse({
    status: 200,
    description: 'ESG questionnaire processed and queued for review',
  })
  @ApiResponse({ status: 403, description: 'Not authorized for this deal' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async submitEsgQuestionnaire(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: EsgQuestionnaireDto,
  ) {
    return this.esgScoringService.submitQuestionnaire(id, req.user.id, dto);
  }

  @Get(':id/esg-score')
  @ApiOperation({ summary: 'Get computed ESG score and sub-score breakdown' })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  @ApiResponse({ status: 200, description: 'Deal ESG score metrics' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async getDealEsgScore(@Param('id') id: string) {
    return this.esgScoringService.getDealEsgScore(id);
  }

  @Get('admin/esg-queue')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'List deals pending ESG compliance review (Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Pending ESG review deals list' })
  async getEsgReviewQueue() {
    return this.esgScoringService.getPendingReviewDeals();
  }

  // ── Deal Health Indicators (#1002) ────────────────────────────────────────

  @Get(':id/health')
  @ApiOperation({
    summary:
      'Get computed deal health snapshot: risk score, funding pace vs. timeline, and milestone progress vs. expected schedule',
  })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  @ApiResponse({ status: 200, description: 'Deal health snapshot' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async getDealHealth(@Param('id') id: string) {
    return this.dealHealthService.getDealHealth(id);
  }

  @Patch(':id/esg-review')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Approve, reject, or adjust ESG review for a deal (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  @ApiResponse({ status: 200, description: 'ESG review decision applied' })
  async reviewEsgScore(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() body: { approved: boolean; notes?: string; adjustedScore?: number },
  ) {
    return this.esgScoringService.reviewScore(
      id,
      req.user.id,
      body.approved,
      body.notes,
      body.adjustedScore,
    );
  }

  @Post(':id/esg-data')
  @UseGuards(AuthGuard('jwt'), RolesGuard, KycGuard)
  @Roles('trader', 'farmer')
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Update or collect specific ESG data metrics for a deal' })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  async collectDealEsgData(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: Partial<EsgQuestionnaireDto>,
  ) {
    return this.esgScoringService.collectDealEsgData(id, req.user.id, dto);
  }

  @Get('esg/portfolio/summary')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get aggregate portfolio ESG score and distribution for authenticated investor' })
  async getPortfolioEsgSummary(@Request() req: AuthRequest) {
    return this.esgScoringService.aggregatePortfolioEsg(req.user.id);
  }

  @Get('esg/benchmarks')
  @ApiOperation({ summary: 'Get agricultural industry ESG benchmarks (SASB FB-AG / GRI 13)' })
  @ApiQuery({ name: 'commodity', required: false })
  async getEsgBenchmarks(@Query('commodity') commodity?: string) {
    return this.esgScoringService.getIndustryBenchmarks(commodity);
  }

  @Get(':id/esg-benchmark')
  @ApiOperation({ summary: 'Benchmark a deal against SASB/GRI agricultural standards' })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  async benchmarkDeal(@Param('id') id: string) {
    return this.esgScoringService.benchmarkDeal(id);
  }

  @Get(':id/esg-report')
  @ApiOperation({ summary: 'Generate structured ESG disclosure report for a deal' })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  @ApiQuery({ name: 'type', required: false, enum: ['investor', 'regulator'] })
  async getDealEsgReport(
    @Param('id') id: string,
    @Query('type') type?: 'investor' | 'regulator',
  ) {
    return this.esgScoringService.generateEsgReport({
      dealId: id,
      reportType: type || 'investor',
    });
  }

  @Get('esg/reports/portfolio')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Generate structured ESG disclosure report for investor portfolio' })
  @ApiQuery({ name: 'type', required: false, enum: ['investor', 'regulator'] })
  async getPortfolioEsgReport(
    @Request() req: AuthRequest,
    @Query('type') type?: 'investor' | 'regulator',
  ) {
    return this.esgScoringService.generateEsgReport({
      investorId: req.user.id,
      reportType: type || 'investor',
    });
  }

  @Get(':id/esg-optimization')
  @ApiOperation({ summary: 'Get targeted ESG improvement suggestions and score uplift estimates' })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  async getEsgOptimizationSuggestions(@Param('id') id: string) {
    return this.esgScoringService.getOptimizationSuggestions(id);
  }

  @Post(':id/esg-certify')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Issue cryptographic ESG certificate for eligible high-ESG deal (Admin only)' })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  async certifyDeal(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.esgScoringService.certifyDeal(id, req.user.id);
  }

  @Get(':id/esg-certificate')
  @ApiOperation({ summary: 'Retrieve verified ESG certificate for a deal' })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  async getDealCertificate(@Param('id') id: string) {
    return this.esgScoringService.getDealCertificate(id);
  }

  @Get('esg/analytics')
  @ApiOperation({ summary: 'Platform-level ESG analytics, rating distributions, and financial return correlations' })
  async getEsgAnalytics() {
    return this.esgScoringService.getEsgAnalytics();
  }

  @Get(':id/carbon-footprint')
  @ApiOperation({ summary: 'Calculate detailed carbon footprint for a trade deal (transport, storage, processing)' })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  async getDealCarbonFootprint(
    @Param('id') id: string,
    @Query('distanceKm') distanceKm?: number,
    @Query('transportMode') transportMode?: string,
    @Query('storageDays') storageDays?: number,
    @Query('weightTons') weightTons?: number,
  ) {
    return this.esgScoringService.calculateDealCarbonFootprint(id, {
      distanceKm: distanceKm ? Number(distanceKm) : undefined,
      transportMode,
      storageDays: storageDays ? Number(storageDays) : undefined,
      weightTons: weightTons ? Number(weightTons) : undefined,
    });
  }

  @Post(':id/carbon-offset')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Purchase and retire certified carbon offsets to neutralize trade deal footprint' })
  @ApiParam({ name: 'id', description: 'Trade deal UUID' })
  async retireCarbonOffset(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: { projectId: string; tons: number; paymentMethod?: string },
  ) {
    return this.esgScoringService.retireCarbonOffset(id, req.user.id, dto);
  }

  // ── Predictive text & smart suggestions (#1180) ───────────────────────────

  @Get('suggestions')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Get predictive text and smart suggestions for deal creation fields (crops, regions, routes, amounts, recurring fields)',
  })
  @ApiQuery({ name: 'field', required: false, example: 'commodity' })
  @ApiQuery({ name: 'q', required: false, example: 'coc' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Ranked suggestions for the field' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getSuggestions(
    @Request() req: AuthRequest,
    @Query() query: SuggestionQueryDto,
  ) {
    return this.dealSuggestionsService.getSuggestions(req.user.id, query);
  }

  @Get('templates')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'List deal templates for template-based deal creation',
  })
  @ApiResponse({ status: 200, description: 'Available deal templates' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listTemplates(@Request() req: AuthRequest) {
    return this.dealSuggestionsService.listTemplates(req.user.id);
  }

  @Post('from-template')
  @UseGuards(AuthGuard('jwt'), RolesGuard, KycGuard)
  @Roles('trader', 'farmer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Create a draft trade deal pre-filled from a template',
  })
  @ApiResponse({ status: 201, description: 'Trade deal created from template' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Role or KYC requirement not met' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async createFromTemplate(
    @Request() req: AuthRequest,
    @Body() dto: CreateFromTemplateDto,
  ): Promise<TradeDeal> {
    const deal = await this.dealSuggestionsService.createFromTemplate(
      req.user.id,
      dto,
    );
    await (this.cacheManager.stores[0] as any).reset();
    return deal;
  }

  @Post('batch')
  @UseGuards(AuthGuard('jwt'), RolesGuard, KycGuard)
  @Roles('trader', 'farmer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Create multiple similar draft deals from a template in one request',
  })
  @ApiResponse({ status: 201, description: 'Batch of trade deals created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Role or KYC requirement not met' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async createBatch(
    @Request() req: AuthRequest,
    @Body() dto: BatchDealCreationDto,
  ): Promise<{ created: TradeDeal[]; failed: any[] }> {
    const result = await this.dealSuggestionsService.createBatch(
      req.user.id,
      dto,
    );
    await (this.cacheManager.stores[0] as any).reset();
    return result;
  }

  @Post('similarity-check')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Detect existing deals similar to the proposed deal and warn about potential duplicates',
  })
  @ApiResponse({ status: 200, description: 'Similarity check result' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async checkSimilarity(
    @Request() req: AuthRequest,
    @Body() dto: DealSimilarityCheckDto,
  ) {
    return this.dealSuggestionsService.checkSimilarity(req.user.id, dto);
  }

  @Post('suggestion-feedback')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Record suggestion acceptance/rejection or user correction to improve future suggestions',
  })
  @ApiResponse({ status: 200, description: 'Feedback recorded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async recordSuggestionFeedback(
    @Request() req: AuthRequest,
    @Body() dto: SuggestionFeedbackDto,
  ) {
    return this.dealSuggestionsService.recordFeedback(req.user.id, dto);
  }

  @Get('suggestion-analytics')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'trader')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Get suggestion analytics: acceptance rate and estimated time saved',
  })
  @ApiResponse({ status: 200, description: 'Suggestion analytics summary' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Role requirement not met' })
  async getSuggestionAnalytics(@Request() req: AuthRequest) {
    return this.dealSuggestionsService.getAnalytics(req.user.id, req.user.role);
  }
}
