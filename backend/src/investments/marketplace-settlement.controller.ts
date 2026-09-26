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
  Delete,
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
import {
  CancelSecondaryOrderDto,
  CreateSecondaryOrderDto,
  OrderBookQueryDto,
} from './dto/secondary-order.dto';
import { SecondaryOrderStatus } from './entities/secondary-order.entity';

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

  @Post('orders/sell')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create secondary market sell order' })
  @ApiResponse({ status: 201, description: 'Sell order created successfully' })
  async createSellOrder(
    @Request() req: any,
    @Body()
    dto: {
      investmentId: string;
      dealId: string;
      askPrice: number;
      quantity: number;
      expiry?: string;
    },
  ) {
    return this.settlementService.createSellOrder({
      sellerId: req.user.id,
      investmentId: dto.investmentId,
      dealId: dto.dealId,
      askPrice: dto.askPrice,
      quantity: dto.quantity,
      expiry: dto.expiry ? new Date(dto.expiry) : undefined,
    });
  }

  @Post('orders/buy')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create secondary market buy order' })
  @ApiResponse({ status: 201, description: 'Buy order created successfully' })
  async createBuyOrder(
    @Request() req: any,
    @Body()
    dto: {
      dealId: string;
      bidPrice: number;
      quantity: number;
      expiry?: string;
    },
  ) {
    return this.settlementService.createBuyOrder({
      buyerId: req.user.id,
      dealId: dto.dealId,
      bidPrice: dto.bidPrice,
      quantity: dto.quantity,
      expiry: dto.expiry ? new Date(dto.expiry) : undefined,
    });
  }

  @Get('orders/orderbook/:dealId')
  @ApiOperation({ summary: 'Get secondary market order book for a deal' })
  @ApiResponse({ status: 200, description: 'Live bids and asks' })
  async getDealOrderBook(@Param('dealId') dealId: string) {
    return this.settlementService.getDealOrderBook(dealId);
  }

  @Post('secondary-order')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Place a secondary order',
    description:
      'Places a limit, fill-or-kill (fok) or stop-loss order on the book. ' +
      'fok orders are cancelled outright if the full size cannot be filled. ' +
      'stop-loss orders stay dormant until the market price crosses triggerPrice.',
  })
  @ApiResponse({
    status: 201,
    description: 'Order accepted (possibly filled, killed, or still resting)',
  })
  @ApiResponse({ status: 400, description: 'Invalid order parameters' })
  @ApiResponse({ status: 403, description: 'KYC verification required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({
    status: 422,
    description: 'Trigger already crossed, or user has no linked wallet',
  })
  async createOrder(@Request() req: any, @Body() dto: CreateSecondaryOrderDto) {
    return this.settlementService.createOrder(req.user.id, dto);
  }

  @Get('secondary-orders')
  @ApiOperation({
    summary: 'List the current user secondary orders',
    description: 'Retrieves orders placed by the authenticated user.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: SecondaryOrderStatus })
  @ApiResponse({ status: 200, description: 'List of secondary orders' })
  async getMyOrders(
    @Request() req: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: SecondaryOrderStatus,
  ) {
    return this.settlementService.getOrdersByUser(req.user.id, {
      page: page || 1,
      limit: limit || 20,
      status,
    });
  }

  @Get('secondary-order-book')
  @ApiOperation({
    summary: 'Get aggregated order book',
    description:
      'Returns bid and ask depth for a token. Dormant stop orders are excluded ' +
      'because they are not matchable until their trigger fires.',
  })
  @ApiResponse({ status: 200, description: 'Order book snapshot' })
  async getOrderBook(@Query() query: OrderBookQueryDto) {
    return this.settlementService.getOrderBook(query.tokenCode, query.depth);
  }

  @Get('secondary-order/:orderId')
  @ApiOperation({
    summary: 'Get a secondary order by order ID',
    description: 'Retrieves a single order including its fill state.',
  })
  @ApiResponse({ status: 200, description: 'Secondary order details' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrder(@Param('orderId') orderId: string) {
    return this.settlementService.getOrder(orderId);
  }

  @Delete('secondary-order/:orderId')
  @ApiOperation({
    summary: 'Cancel a secondary order',
    description:
      'Cancels a resting order. FOK orders killed for want of liquidity, ' +
      'expired orders and already filled orders cannot be cancelled.',
  })
  @ApiResponse({ status: 200, description: 'Order cancelled' })
  @ApiResponse({ status: 400, description: 'Order is not cancellable' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async cancelOrder(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() dto: CancelSecondaryOrderDto,
  ) {
    return this.settlementService.cancelOrder(orderId, req.user.id, dto);
  }
}
