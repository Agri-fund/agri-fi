import {
  Controller,
  Post,
  Get,
  Patch,
  Put,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  Request,
  HttpCode,
  HttpStatus,
  Query,
  Headers,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
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
import { Throttle } from '@nestjs/throttler';
import { InvestmentsService } from './investments.service';
import {
  PortfolioSummary,
  PortfolioSummaryService,
} from './portfolio-summary.service';
import { TaxReportService, TaxReportFormat } from './tax-report.service';
import { TaxReportQueryDto } from './dto/tax-report-query.dto';
import { TaxStatementQueryDto } from './dto/tax-statement-query.dto';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { KycGuard, RolesGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { StellarService } from '../stellar/stellar.service';
import { PaginatedResult } from '../common/pagination';
import { TradeDealsGuard } from '../trade-deals/trade-deals.guard';
import { IdempotencyService } from '../queue/idempotency.service';
import { InvestmentEventStore } from './investment-event-store.service';
import { ReceiptService } from './receipt.service';
import { InvoiceService } from './invoice.service';
import { CancelInvestmentDto } from './dto/cancel-investment.dto';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { PortfolioVaRService } from './portfolio-var.service';
import {
  PortfolioVaRQueryDto,
  PortfolioVaRStressTestDto,
  SetPortfolioVaRLimitDto,
} from './dto/portfolio-var.dto';

@ApiTags('investments')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller('investments')
export class InvestmentsController {
  constructor(
    private readonly investmentsService: InvestmentsService,
    private readonly stellarService: StellarService,
    private readonly idempotency: IdempotencyService,
    private readonly eventStore: InvestmentEventStore,
    private readonly taxReportService: TaxReportService,
    private readonly receiptService: ReceiptService,
    private readonly invoiceService: InvoiceService,
    private readonly portfolioSummaryService: PortfolioSummaryService,
    private readonly portfolioVaRService: PortfolioVaRService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Create an investment (investor only)' })
  @ApiResponse({
    status: 201,
    description:
      'Investment created, returns pending investment and unsigned Stellar XDR',
    schema: {
      type: 'object',
      properties: {
        investment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            tradeDealId: { type: 'string', format: 'uuid' },
            investorId: { type: 'string', format: 'uuid' },
            tokenAmount: { type: 'number' },
            amountUsd: { type: 'string' },
            status: { type: 'string', enum: ['pending'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        unsignedXdr: {
          type: 'string',
          description:
            'Base64-encoded unsigned Stellar XDR transaction envelope',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Only investors can create investments',
  })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  @ApiResponse({ status: 409, description: 'Deal already fully funded' })
  @ApiResponse({
    status: 422,
    description:
      'No wallet address linked / deal not open / insufficient tokens',
  })
  @ApiResponse({ status: 429, description: 'Too Many Requests' })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async createInvestment(
    @Request() req: { user: { id: string; role: string } },
    @Body() createInvestmentDto: CreateInvestmentDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const key = IdempotencyService.buildKey(
        'investment.create',
        idempotencyKey,
      );
      const lease = await this.idempotency.acquireLease(key, 300);
      if (!lease.acquired) {
        throw new ConflictException('Duplicate investment request detected.');
      }
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
  @ApiResponse({
    status: 200,
    description: 'Escrow funding initiated',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['queued', 'confirmed'] },
        investmentId: { type: 'string' },
        stellarTxId: { type: 'string' },
      },
    },
  })
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
    @Body('signedXdr') signedXdr?: string,
  ) {
    if (req.user.role !== 'investor') {
      throw new Error('Only investors can fund investments.');
    }
    return this.investmentsService.fundEscrow(
      id,
      investorWalletAddress,
      signedXdr,
    );
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
  @ApiResponse({
    status: 403,
    description: 'Only the investment owner can confirm this investment',
  })
  @ApiResponse({ status: 404, description: 'Investment not found' })
  async confirmInvestment(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body('stellarTxId') stellarTxId: string,
  ) {
    return this.investmentsService.confirmInvestment(
      req.user.id,
      id,
      stellarTxId,
    );
  }

  @Get('trade-deal/:tradeDealId')
  @UseGuards(TradeDealsGuard)
  @ApiOperation({ summary: 'List all investments for a trade deal' })
  @ApiParam({ name: 'tradeDealId', description: 'Trade deal UUID' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'List of investments' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
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
  @ApiResponse({
    status: 403,
    description: 'Only investors can access this endpoint',
  })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
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

  @Get('summary')
  @ApiOperation({
    summary: 'Portfolio summary for the authenticated investor',
    description:
      'Totals and per-deal allocation used by the investor dashboard summary widget (#789). Cancelled and refunded positions are excluded from the invested total; realised amounts come from confirmed payment distributions.',
  })
  @ApiResponse({ status: 200, description: 'Portfolio summary' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Only investors can access this endpoint',
  })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async getPortfolioSummary(
    @Request() req: { user: { id: string } },
  ): Promise<PortfolioSummary> {
    return this.portfolioSummaryService.getSummary(req.user.id);
  }

  @Get('risk/var')
  @ApiOperation({
    summary: 'Calculate portfolio Value at Risk and Expected Shortfall',
    description:
      'Uses selected, validated commodity oracle observations and active portfolio exposures valued at invested amount.',
  })
  @ApiResponse({
    status: 200,
    description: 'Portfolio VaR, ES, components, and trend',
  })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async getPortfolioVaR(
    @Request() req: { user: { id: string } },
    @Query() query: PortfolioVaRQueryDto,
  ) {
    return this.portfolioVaRService.calculate(req.user.id, query);
  }

  @Get('risk/var/backtest')
  @ApiOperation({ summary: 'Backtest portfolio VaR against subsequent losses' })
  @ApiResponse({ status: 200, description: 'Rolling historical VaR backtest' })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async backtestPortfolioVaR(
    @Request() req: { user: { id: string } },
    @Query() query: PortfolioVaRQueryDto,
  ) {
    return this.portfolioVaRService.backtest(req.user.id, query);
  }

  @Get('risk/var/report')
  @ApiOperation({
    summary: 'Generate a compliance-oriented portfolio VaR report',
  })
  @ApiResponse({
    status: 200,
    description: 'VaR calculation and backtest report',
  })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async getPortfolioVaRReport(
    @Request() req: { user: { id: string } },
    @Query() query: PortfolioVaRQueryDto,
  ) {
    return this.portfolioVaRService.generateReport(req.user.id, query);
  }

  @Post('risk/var/stress-test')
  @ApiOperation({ summary: 'Apply commodity price shocks to the portfolio' })
  @ApiResponse({
    status: 200,
    description: 'Stressed portfolio values and losses',
  })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async stressTestPortfolioVaR(
    @Request() req: { user: { id: string } },
    @Body() dto: PortfolioVaRStressTestDto,
  ) {
    return this.portfolioVaRService.stressTest(req.user.id, dto.scenarios);
  }

  @Put('risk/var/limit')
  @ApiOperation({
    summary: 'Set an investor VaR limit and enable breach alerts',
  })
  @ApiResponse({ status: 200, description: 'VaR limit saved' })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async setPortfolioVaRLimit(
    @Request() req: { user: { id: string } },
    @Body() dto: SetPortfolioVaRLimitDto,
  ) {
    return this.portfolioVaRService.setLimit(req.user.id, dto);
  }

  /**
   * Issue #788 — investor-initiated soft-cancel within the regulatory
   * cooling-off window (default 48h, configurable via
   * INVESTMENT_COOLING_OFF_HOURS), while the investment is still PENDING
   * (i.e. before any funds have moved on-chain via fundEscrow).
   */
  @Patch(':id/cancel')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({
    summary:
      'Cancel a pending investment within the cooling-off window (investor only, #788)',
  })
  @ApiParam({ name: 'id', description: 'Investment UUID' })
  @ApiResponse({ status: 200, description: 'Investment cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — investor role required and must own the investment',
  })
  @ApiResponse({ status: 404, description: 'Investment not found' })
  @ApiResponse({
    status: 422,
    description:
      'Investment is no longer pending, or the cooling-off window has passed',
  })
  @UseGuards(RolesGuard)
  @Roles('investor')
  async cancelInvestment(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: CancelInvestmentDto,
  ) {
    return this.investmentsService.requestCoolingOffCancel(
      req.user.id,
      id,
      dto.reason,
    );
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
              issuerPublicKey: { type: 'string' },
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
      issuerPublicKey: string;
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

  /**
   * Issue #112 — Secondary Market: Fetch active buy orders (bids) for a trade token.
   *
   * Security: explicit AuthGuard at the method level ensures this endpoint always
   * requires a valid JWT, even if the class-level guard is ever refactored away.
   * Exposing the token issuer public key to unauthenticated callers would allow
   * anyone to query the Stellar DEX for deal data without authentication.
   */
  /**
   * Issue #850 — Investor tax report export (CSV and PDF).
   */
  @Get('tax-report')
  @ApiOperation({
    summary: 'Export investor tax report for a financial year (#850)',
  })
  @ApiQuery({ name: 'year', required: true, example: 2025 })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['csv', 'pdf'],
    example: 'csv',
  })
  @ApiResponse({ status: 200, description: 'Tax report file download' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async taxReport(
    @Request() req: { user: { id: string } },
    @Query() query: TaxReportQueryDto,
    @Res() res: Response,
  ) {
    const report = await this.taxReportService.buildReportData(
      req.user.id,
      query.year,
    );
    const format = query.format ?? TaxReportFormat.CSV;

    if (format === TaxReportFormat.CSV) {
      const csv = this.taxReportService.toCsv(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="tax-report-${query.year}.csv"`,
      );
      return res.send('﻿' + csv); // BOM for Excel compatibility
    }

    return this.sendTaxStatement(req.user.id, query.year, res);
  }

  /**
   * Issue #1298 — PDF investment tax statement.
   * Small portfolios are rendered inline; large ones are queued and the
   * download link is emailed to the investor (HTTP 202).
   */
  @Get('tax-statement')
  @ApiOperation({
    summary: 'Download the investor tax statement as a PDF (#1298)',
  })
  @ApiQuery({ name: 'year', required: false, example: 2024 })
  @ApiResponse({ status: 200, description: 'PDF tax statement download' })
  @ApiResponse({
    status: 202,
    description:
      'Large portfolio — generation queued; a download link will be emailed',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(KycGuard, RolesGuard)
  @Roles('investor')
  async taxStatement(
    @Request() req: { user: { id: string } },
    @Query() query: TaxStatementQueryDto,
    @Res() res: Response,
  ) {
    const year = query.year ?? new Date().getUTCFullYear();
    return this.sendTaxStatement(req.user.id, year, res);
  }

  private async sendTaxStatement(
    investorId: string,
    year: number,
    res: Response,
  ) {
    const result = await this.taxReportService.requestStatement(
      investorId,
      year,
    );

    if (result.queued) {
      return res.status(HttpStatus.ACCEPTED).json({
        message:
          'Your tax statement is large and is being generated — you will receive an email with a download link when it is ready.',
        year: result.year,
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.setHeader('Content-Length', String(result.pdf.length));
    return res.send(result.pdf);
  }

  @Get('buy-orders/:tokenCode/:tokenIssuer')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Get active DEX buy offers for a trade token (buy order book)',
  })
  @ApiParam({ name: 'tokenCode', description: 'Trade token asset code' })
  @ApiParam({
    name: 'tokenIssuer',
    description: 'Trade token issuer public key',
  })
  @ApiResponse({ status: 200, description: 'List of active buy offers' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized – valid JWT required to access the order book',
  })
  async getActiveBuyOrders(
    @Param('tokenCode') tokenCode: string,
    @Param('tokenIssuer') tokenIssuer: string,
  ) {
    return this.stellarService.getActiveBuyOrdersForToken(
      tokenCode,
      tokenIssuer,
    );
  }

  /**
   * Issue #808 — PDF payment receipt for investors.
   * Generates (or returns a cached) pre-signed S3 URL to the PDF receipt.
   */
  @Get(':id/receipt')
  @ApiOperation({
    summary:
      'Get a pre-signed S3 URL for the PDF payment receipt (investor only, #808)',
  })
  @ApiParam({ name: 'id', description: 'Investment UUID' })
  @ApiResponse({
    status: 200,
    description: 'Pre-signed receipt URL valid for 15 minutes',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Pre-signed S3 URL' },
        expiresAt: {
          type: 'string',
          format: 'date-time',
          description: 'URL expiry timestamp (ISO 8601)',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden – investor role required and must own the investment',
  })
  @ApiResponse({ status: 404, description: 'Investment not found' })
  @UseGuards(RolesGuard)
  @Roles('investor')
  async getReceipt(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.receiptService.generateReceipt(id, req.user.id);
  }

  @Get(':id/events')
  @ApiOperation({
    summary:
      'Get event log history for an investment (admin or investment owner)',
  })
  @ApiParam({ name: 'id', description: 'Investment UUID' })
  @ApiResponse({ status: 200, description: 'List of investment events' })
  @ApiResponse({ status: 403, description: 'Forbidden - owner or admin only' })
  @ApiResponse({ status: 404, description: 'Investment not found' })
  async getInvestmentEvents(
    @Request() req: { user: { id: string; role: string } },
    @Param('id') id: string,
  ) {
    const investment = await this.investmentsService.getInvestmentById(id);
    if (!investment) {
      throw new NotFoundException('Investment not found.');
    }

    if (req.user.role !== 'admin' && investment.investorId !== req.user.id) {
      throw new ForbiddenException(
        'Only investment owner or admin can access investment events.',
      );
    }

    return this.eventStore.getEvents(id);
  }

  /**
   * Issue #1026 — Invoice download per disbursement for institutional investors.
   * Generates a PDF invoice with platform fee line items.
   */
  @Get('disbursements/:paymentDistributionId/invoice')
  @ApiOperation({
    summary:
      'Download PDF invoice for a payment distribution (investor only, #1026)',
  })
  @ApiParam({
    name: 'paymentDistributionId',
    description: 'Payment Distribution UUID',
  })
  @ApiQuery({
    name: 'locale',
    required: false,
    example: 'en',
    description: 'Localization for invoice text',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF invoice file download',
    content: {
      'application/pdf': {},
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - investor role required and must own the disbursement',
  })
  @ApiResponse({ status: 404, description: 'Payment distribution not found' })
  @UseGuards(RolesGuard)
  @Roles('investor')
  async getInvoice(
    @Request() req: { user: { id: string } },
    @Param('paymentDistributionId') paymentDistributionId: string,
    @Query('locale') locale: string = 'en',
    @Res() res: Response,
  ) {
    const invoiceData = await this.invoiceService.getInvoiceData(
      paymentDistributionId,
      req.user.id,
    );

    const pdfBuffer = this.invoiceService.generateInvoicePdf(invoiceData, locale);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${invoiceData.invoiceNumber}.pdf"`,
    );
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.send(pdfBuffer);
  }
}
