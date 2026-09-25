import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiParam,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { ApiKeyThrottlerGuard } from '../common/throttler/api-key-throttler.guard';
import { RequireApiKeyScopes } from '../auth/decorators/api-key-scopes.decorator';
import { PublicDealQueryDto } from './dto/public-deal-query.dto';
import { CreatePublicWebhookSubscriptionDto } from './dto/public-webhook.dto';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { WebhooksService } from '../webhooks/webhooks.service';

@ApiTags('Public v1 - Partners & Integrations')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, ApiKeyThrottlerGuard)
@Controller('v1/public')
export class PublicApiController {
  constructor(
    private readonly tradeDealsService: TradeDealsService,
    private readonly webhooksService: WebhooksService,
  ) {}

  @Get('deals')
  @RequireApiKeyScopes('read:deals')
  @ApiOperation({
    summary: 'List marketplace deals and agricultural campaigns',
    description: 'Returns active trade deals and investment campaigns. Requires read:deals scope.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of trade deals',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  @ApiResponse({ status: 403, description: 'API key lacks read:deals scope' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (120 req/min)' })
  async listDeals(@Query() query: PublicDealQueryDto) {
    const limit = query.limit || 20;
    const offset = query.offset || 0;
    const page = Math.floor(offset / limit) + 1;

    const result = await this.tradeDealsService.searchDeals({
      commodity: query.commodity,
      q: query.search,
      page,
      limit,
    });

    return {
      object: 'list',
      data: result.data,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + limit < result.total,
      },
    };
  }

  @Get('deals/:id')
  @RequireApiKeyScopes('read:deals')
  @ApiOperation({
    summary: 'Retrieve trade deal details',
    description: 'Returns full specification, milestone schedule, escrow parameters, and funding status for a deal.',
  })
  @ApiParam({ name: 'id', description: 'Deal UUID identifier' })
  @ApiResponse({ status: 200, description: 'Trade deal detailed representation' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  async getDealDetail(@Param('id') id: string) {
    const deal = await this.tradeDealsService.getDealById(id);
    if (!deal) {
      throw new NotFoundException(`Trade deal with ID ${id} not found`);
    }
    return deal;
  }

  @Post('webhooks')
  @RequireApiKeyScopes('webhook:manage')
  @ApiOperation({
    summary: 'Register partner webhook subscription',
    description: 'Subscribes an HTTPS webhook endpoint to platform events (deal.funded, milestone.completed, settlement.completed). Requires webhook:manage scope.',
  })
  @ApiResponse({ status: 201, description: 'Webhook subscription successfully registered' })
  @ApiResponse({ status: 403, description: 'API key lacks webhook:manage scope' })
  async subscribeWebhook(@Body() dto: CreatePublicWebhookSubscriptionDto) {
    const sub = await this.webhooksService.createSubscription({
      url: dto.url,
      events: dto.events,
      secret: dto.secret,
      isActive: true,
    });

    return {
      id: sub.id,
      url: sub.url,
      events: sub.events,
      isActive: sub.isActive,
      createdAt: (sub as any).createdAt || new Date(),
    };
  }

  @Get('webhooks')
  @RequireApiKeyScopes('webhook:manage')
  @ApiOperation({
    summary: 'List registered webhook subscriptions',
    description: 'Retrieves all active webhook subscriptions registered under this partner account.',
  })
  @ApiResponse({ status: 200, description: 'List of webhook subscriptions' })
  async listWebhooks() {
    const subs = await this.webhooksService.findAllSubscriptions();
    return {
      object: 'list',
      data: subs.map((sub) => ({
        id: sub.id,
        url: sub.url,
        events: sub.events,
        isActive: sub.isActive,
      })),
    };
  }

  @Delete('webhooks/:id')
  @RequireApiKeyScopes('webhook:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete webhook subscription',
    description: 'Removes an existing webhook subscription by ID.',
  })
  @ApiParam({ name: 'id', description: 'Webhook subscription UUID' })
  @ApiResponse({ status: 204, description: 'Webhook subscription deleted' })
  @ApiResponse({ status: 404, description: 'Webhook subscription not found' })
  async deleteWebhook(@Param('id') id: string) {
    await this.webhooksService.deleteSubscription(id);
  }
}
