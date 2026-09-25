import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Sep24Service, Sep24CallbackPayload } from './sep24.service';
import { User } from '../auth/entities/user.entity';
import { WebhookSignatureGuard } from '../auth/webhook-signature.guard';
import { Sep24TxKind } from './entities/sep24-transaction.entity';

/**
 * SEP-24 Interactive Deposit/Withdrawal endpoints.
 * Exposed at /sep24 (version-neutral) to match stellar.toml TRANSFER_SERVER_SEP0024.
 *
 * Issue #353 — Integrate SEP-24 Interactive Deposit and Withdrawal protocol.
 */
@ApiTags('sep24')
@Controller({ path: 'sep24', version: VERSION_NEUTRAL })
export class Sep24Controller {
  constructor(private readonly sep24Service: Sep24Service) {}

  @Get('info')
  @ApiOperation({ summary: 'SEP-24 transfer server info' })
  @ApiResponse({ status: 200, description: 'Supported assets and fees' })
  getInfo() {
    return this.sep24Service.getInfo();
  }

  @Post('transactions/deposit/interactive')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Initiate an interactive deposit (fiat → USDC)' })
  @ApiResponse({ status: 200, description: 'Interactive flow URL returned' })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Account mismatch' })
  async depositInteractive(
    @Body() body: Record<string, string>,
    @Req() req: Request,
  ) {
    const user = req.user as User;
    this.sep24Service.assertAccountMatchesWallet(
      body.account,
      user.walletAddress,
    );

    return this.sep24Service.initiateDepositInteractive(
      {
        asset_code: body.asset_code,
        account: body.account,
        amount: body.amount,
      },
      user.id,
    );
  }

  @Post('transactions/withdraw/interactive')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Initiate an interactive withdrawal (USDC → fiat)' })
  @ApiResponse({ status: 200, description: 'Interactive flow URL returned' })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Account mismatch' })
  async withdrawInteractive(
    @Body() body: Record<string, string>,
    @Req() req: Request,
  ) {
    const user = req.user as User;
    this.sep24Service.assertAccountMatchesWallet(
      body.account,
      user.walletAddress,
    );

    return this.sep24Service.initiateWithdrawInteractive(
      {
        asset_code: body.asset_code,
        account: body.account,
        amount: body.amount,
        dest: body.dest,
        dest_extra: body.dest_extra,
      },
      user.id,
    );
  }

  @Get('transaction')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get a single SEP-24 transaction by ID' })
  @ApiResponse({ status: 200, description: 'Transaction details' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async getTransaction(@Query('id') id: string, @Req() req: Request) {
    const user = req.user as User;
    if (!user.walletAddress) {
      this.sep24Service.assertAccountMatchesWallet('', null);
    }
    return this.sep24Service.getTransaction(id, user.walletAddress!);
  }

  @Get('transactions/deposit')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'List deposit transactions for the authenticated account',
  })
  async listDeposits(@Req() req: Request) {
    const user = req.user as User;
    if (!user.walletAddress) {
      this.sep24Service.assertAccountMatchesWallet('', null);
    }
    return this.sep24Service.listTransactions(
      Sep24TxKind.DEPOSIT,
      user.walletAddress!,
    );
  }

  @Get('transactions/withdraw')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'List withdrawal transactions for the authenticated account',
  })
  async listWithdrawals(@Req() req: Request) {
    const user = req.user as User;
    if (!user.walletAddress) {
      this.sep24Service.assertAccountMatchesWallet('', null);
    }
    return this.sep24Service.listTransactions(
      Sep24TxKind.WITHDRAW,
      user.walletAddress!,
    );
  }

  /**
   * Webhook endpoint for external payment processors to push transaction status updates.
   * Protected by HMAC-SHA256 signature (x-webhook-signature header).
   */
  @Post('callback')
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Receive SEP-24 transaction status callbacks from payment processors',
  })
  @ApiHeader({
    name: 'x-webhook-signature',
    description: 'HMAC-SHA256 hex signature of the raw request body',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Callback processed' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  async handleCallback(@Body() payload: Sep24CallbackPayload) {
    await this.sep24Service.handleStatusCallback(payload);
    return { received: true };
  }
}
