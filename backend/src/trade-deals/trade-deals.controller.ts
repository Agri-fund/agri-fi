import {
  Controller,
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

import { TradeDealAccessRequest, TradeDealsGuard } from './trade-deals.guard';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('trade-deals')
@Controller('trade-deals')
export class TradeDealsController {
  constructor(
    private readonly tradeDealsService: TradeDealsService,
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
    description: 'Deal not in draft status or missing documents',
  })
  async publishDeal(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ): Promise<TradeDeal> {
    const deal = await this.tradeDealsService.publishDeal(id, req.user.id);
    await this.cacheManager.reset();
    return deal;
  }

  @Get()
  @Throttle({ marketplace: { limit: 60, ttl: 60000 } })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30000)
  @ApiOperation({ summary: 'List open trade deals (marketplace)' })
  @ApiQuery({ name: 'commodity', required: false, example: 'Cocoa' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 12 })
  @ApiResponse({ status: 200, description: 'Paginated list of open deals' })
  async findOpen(
    @Query('commodity') commodity?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    return this.tradeDealsService.findOpen({
      commodity,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
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
    await this.cacheManager.reset();
    return deal;
  }
}
