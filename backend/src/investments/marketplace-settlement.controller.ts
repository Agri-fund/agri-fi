import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { KycGuard } from '../auth/kyc.guard';
import {
  MarketplaceSettlementService,
  CreateSecondaryTradeDto,
} from './marketplace-settlement.service';

@ApiTags('Marketplace Settlement')
@ApiBearerAuth()
@UseGuards(KycGuard)
@Controller('investments')
export class MarketplaceSettlementController {
  constructor(
    private readonly settlementService: MarketplaceSettlementService,
  ) {}

  @Post('secondary-trade')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a secondary trade',
    description:
      'Initiates a secondary market trade between a seller and buyer. ' +
      'The trade is settled on-chain via the marketplace_settlement Soroban contract.',
  })
  @ApiResponse({
    status: 201,
    description: 'Secondary trade created and settled successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'KYC verification required' })
  @ApiResponse({ status: 404, description: 'Seller or buyer not found' })
  @ApiResponse({
    status: 422,
    description: 'Settlement failed - order remains open',
  })
  async createSecondaryTrade(
    @Request() req: any,
    @Body() dto: CreateSecondaryTradeDto,
  ) {
    return this.settlementService.createSecondaryTrade(dto);
  }

  @Get('secondary-trade/:id')
  @ApiOperation({
    summary: 'Get secondary trade by ID',
    description: 'Retrieves details of a specific secondary trade.',
  })
  @ApiResponse({
    status: 200,
    description: 'Secondary trade details',
  })
  @ApiResponse({ status: 404, description: 'Trade not found' })
  async getSecondaryTrade(@Param('id') id: string) {
    return this.settlementService.getSecondaryTrade(id);
  }

  @Get('secondary-trades')
  @ApiOperation({
    summary: 'Get secondary trades for current user',
    description:
      'Retrieves secondary trades where the user is either seller or buyer.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'List of secondary trades',
  })
  async getMySecondaryTrades(
    @Request() req: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.settlementService.getSecondaryTradesByUser(req.user.id, {
      page: page || 1,
      limit: limit || 20,
    });
  }

  @Get('secondary-trade/order/:orderId')
  @ApiOperation({
    summary: 'Get secondary trade by Soroban order ID',
    description: 'Retrieves a secondary trade using its on-chain order ID.',
  })
  @ApiResponse({
    status: 200,
    description: 'Secondary trade details',
  })
  @ApiResponse({ status: 404, description: 'Trade not found' })
  async getSecondaryTradeByOrderId(@Param('orderId') orderId: string) {
    return this.settlementService.getSecondaryTradeByOrderId(orderId);
  }
}
