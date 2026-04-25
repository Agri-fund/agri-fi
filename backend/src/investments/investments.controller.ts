import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { InvestmentsService } from './investments.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { KycGuard } from '../auth/kyc.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { StellarService } from '../stellar/stellar.service';
import { PaginatedResult } from '../common/pagination';

@ApiTags('investments')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller('investments')
export class InvestmentsController {
  constructor(
    private readonly investmentsService: InvestmentsService,
    private readonly stellarService: StellarService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an investment (investor only)' })
  @ApiResponse({
    status: 201,
    description: 'Investment created, returns unsigned Stellar XDR',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Only investors can create investments',
  })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  @ApiResponse({ status: 409, description: 'Deal already fully funded' })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async createInvestment(
    @Request() req: { user: { id: string; role: string } },
    @Body() createInvestmentDto: CreateInvestmentDto,
  ) {
    if (req.user.role !== 'investor') {
      throw new Error('Only investors can create investments.');
    }
    return this.investmentsService.createInvestment(
      req.user.id,
      createInvestmentDto,
    );
  }

  @Post(':id/fund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate escrow funding for an investment (investor only)',
  })
  @ApiParam({ name: 'id', description: 'Investment UUID' })
  @ApiBody({
    schema: {
      properties: {
        investorWalletAddress: {
          type: 'string',
          example: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Escrow funding initiated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Only investors can fund investments',
  })
  @ApiResponse({ status: 404, description: 'Investment not found' })
  @UseGuards(RolesGuard)
  @Roles('investor')
  async fundEscrow(
    @Request() req: { user: { id: string; role: string } },
    @Param('id') id: string,
    @Body('investorWalletAddress') investorWalletAddress: string,
  ) {
    if (req.user.role !== 'investor') {
      throw new Error('Only investors can fund investments.');
    }
    return this.investmentsService.fundEscrow(id, investorWalletAddress);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm investment by submitting signed Stellar XDR',
  })
  @ApiParam({ name: 'id', description: 'Investment UUID' })
  @ApiBody({
    schema: {
      properties: { stellarTxId: { type: 'string', example: 'abc123...' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Investment confirmed on-chain' })
  @ApiResponse({ status: 400, description: 'Invalid transaction' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Investment not found' })
  async confirmInvestment(
    @Param('id') id: string,
    @Body('stellarTxId') stellarTxId: string,
  ) {
    return this.investmentsService.confirmInvestment(id, stellarTxId);
  }

  @Get('trade-deal/:tradeDealId')
  @ApiOperation({ summary: 'List all investments for a trade deal' })
  @ApiParam({ name: 'tradeDealId', description: 'Trade deal UUID' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'List of investments' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async getInvestmentsByTradeDeal(
    @Param('tradeDealId') tradeDealId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedResult<any>> {
    return this.investmentsService.getInvestmentsByTradeDeal(tradeDealId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('my-investments')
  @ApiOperation({ summary: "List the authenticated investor's investments" })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'List of investments' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyInvestments(
    @Request() req: { user: { id: string } },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedResult<any>> {
    return this.investmentsService.getInvestmentsByInvestor(req.user.id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * Issue #92 — Bulk Investments via Stellar Batching
   * Accepts multiple deal investments and returns a single unsigned XDR
   * that bundles all USDC payment operations into one transaction.
   */
  @Post('bulk-transaction')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Build a bulk investment transaction (institutional investors, max 100 deals)',
  })
  @ApiBody({
    schema: {
      properties: {
        investorWalletAddress: { type: 'string' },
        investments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              escrowPublicKey: { type: 'string' },
              amountUSD: { type: 'number' },
              assetCode: { type: 'string' },
              tokenAmount: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Unsigned XDR for the bulk transaction',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(RolesGuard)
  @Roles('investor')
  async buildBulkTransaction(
    @Body('investorWalletAddress') investorWalletAddress: string,
    @Body('investments')
    investments: Array<{
      escrowPublicKey: string;
      amountUSD: number;
      assetCode: string;
      tokenAmount: number;
    }>,
  ) {
    const unsignedXdr =
      await this.stellarService.createBulkInvestmentTransaction(
        investorWalletAddress,
        investments,
      );
    return { unsignedXdr };
  }

  /**
   * Issue #88 — Secondary Market: Build a Sell Offer transaction for a trade token.
   * Returns an unsigned XDR the investor signs with their wallet (Freighter/Albedo).
   */
  @Post('sell-offer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Build a DEX sell offer transaction for trade tokens (secondary market)',
  })
  @ApiBody({
    schema: {
      properties: {
        sellerWalletAddress: { type: 'string' },
        tradeTokenCode: { type: 'string' },
        tradeTokenIssuer: { type: 'string' },
        tokenAmount: { type: 'number' },
        pricePerToken: { type: 'string', example: '1.05' },
        offerId: {
          type: 'number',
          description: '0 to create a new offer; non-zero to update/cancel',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Unsigned XDR for the sell offer transaction',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(RolesGuard)
  @Roles('investor')
  async buildSellOffer(
    @Body('sellerWalletAddress') sellerWalletAddress: string,
    @Body('tradeTokenCode') tradeTokenCode: string,
    @Body('tradeTokenIssuer') tradeTokenIssuer: string,
    @Body('tokenAmount') tokenAmount: number,
    @Body('pricePerToken') pricePerToken: string,
    @Body('offerId') offerId?: number,
  ) {
    const unsignedXdr = await this.stellarService.createSellOfferTransaction(
      sellerWalletAddress,
      tradeTokenCode,
      tradeTokenIssuer,
      tokenAmount,
      pricePerToken,
      offerId ?? 0,
    );
    return { unsignedXdr };
  }

  /**
   * Issue #88 — Secondary Market: Fetch active sell offers for a trade token
   * so the deal details page can show the DEX order book.
   */
  @Get('offers/:tokenCode/:tokenIssuer')
  @ApiOperation({
    summary: 'Get active DEX sell offers for a trade token (order book)',
  })
  @ApiParam({ name: 'tokenCode', description: 'Trade token asset code' })
  @ApiParam({
    name: 'tokenIssuer',
    description: 'Trade token issuer public key',
  })
  @ApiResponse({ status: 200, description: 'List of active sell offers' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getActiveOffers(
    @Param('tokenCode') tokenCode: string,
    @Param('tokenIssuer') tokenIssuer: string,
  ) {
    return this.stellarService.getActiveOffersForToken(tokenCode, tokenIssuer);
  }
}
