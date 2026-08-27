import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  HttpException,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { StellarService } from './stellar.service';
import { User } from '../auth/entities/user.entity';
import {
  TransactionBuilder,
  Networks,
  FeeBumpTransaction,
} from '@stellar/stellar-sdk';

@ApiTags('stellar')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ version: '1', path: 'stellar' })
export class StellarController {
  private readonly networkPassphrase: string;
  constructor(
    private readonly stellarService: StellarService,
    private readonly configService: ConfigService,
  ) {
    const network = this.configService.get<string>(
      'STELLAR_NETWORK',
      'testnet',
    );
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  }

  /**
   * Submits a pre-signed XDR transaction to the Stellar network.
   * Used by the frontend after the user signs a transaction with Freighter or Albedo.
   * Issue #83 — Client-Side Signing; Issue #88 — Secondary Market
   */
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Submit a signed XDR transaction to Stellar' })
  @ApiBody({
    schema: {
      properties: {
        signedXdr: {
          type: 'string',
          description: 'Base64-encoded signed transaction XDR',
        },
      },
      required: ['signedXdr'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction submitted successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid XDR or transaction rejected',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 429, description: 'Too Many Requests' })
  async submitTransaction(
    @Body('signedXdr') signedXdr: string,
    @Req() req: Request,
  ) {
    let sourceAccount: string;
    try {
      const transaction = TransactionBuilder.fromXDR(
        signedXdr,
        this.networkPassphrase,
      );
      sourceAccount =
        transaction instanceof FeeBumpTransaction
          ? transaction.feeSource
          : transaction.source;
    } catch {
      throw new HttpException(
        'Invalid XDR: transaction could not be decoded',
        HttpStatus.BAD_REQUEST,
      );
    }
    const caller = req.user as User;
    if (!caller.walletAddress) {
      throw new HttpException(
        'No wallet address linked to your account',
        HttpStatus.FORBIDDEN,
      );
    }
    if (sourceAccount !== caller.walletAddress) {
      throw new HttpException(
        'Transaction source account does not match your linked wallet',
        HttpStatus.FORBIDDEN,
      );
    }
    const result = await this.stellarService.submitTransaction(signedXdr, {
      allowedOpTypes: ['payment', 'changeTrust', 'manageSellOffer', 'manageBuyOffer', 'pathPaymentStrictSend', 'pathPaymentStrictReceive'],
    });
    return { hash: result?.hash ?? (result as any)?.id, success: true };
  }

  /**
   * Executes a clawback operation for a specific asset and investor.
   * Only accessible by admin users.
   */
  @Post('clawback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute a clawback operation for an asset' })
  @ApiBody({
    schema: {
      properties: {
        assetCode: { type: 'string' },
        issuerPublicKey: { type: 'string' },
        issuerSecret: { type: 'string' },
        targetWallet: { type: 'string' },
        amount: { type: 'string' },
      },
      required: ['assetCode', 'issuerPublicKey', 'issuerSecret', 'targetWallet', 'amount'],
    },
  })
  @ApiResponse({ status: 200, description: 'Clawback executed successfully' })
  @ApiResponse({ status: 400, description: 'Missing required parameters' })
  @ApiResponse({ status: 403, description: 'Forbidden: Admins only' })
  async executeClawback(
    @Body('assetCode') assetCode: string,
    @Body('issuerPublicKey') issuerPublicKey: string,
    @Body('issuerSecret') issuerSecret: string,
    @Body('targetWallet') targetWallet: string,
    @Body('amount') amount: string,
    @Req() req: Request,
  ) {
    const caller = req.user as User;
    if (caller.role !== 'admin') {
      throw new HttpException('Only admins can execute clawbacks', HttpStatus.FORBIDDEN);
    }

    if (!assetCode || !issuerPublicKey || !issuerSecret || !targetWallet || !amount) {
      throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.stellarService.clawbackTokens(
        assetCode,
        issuerPublicKey,
        issuerSecret,
        [{ walletAddress: targetWallet, tokenAmount: parseFloat(amount) }]
      );
      return { success: true };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Clawback failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Configures multi-signature authorization for the platform fee wallet.
   * Requires 2 of 3 signatures for transfers to prevent theft of platform fees.
   * Issue #352 — Stellar multi-signature setup for platform fee wallet.
   * Only accessible by admin users.
   */
  @Post('platform-wallet/setup-multisig')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configure multi-signature for platform fee wallet',
    description: 'Sets up 2-of-3 multi-sig authorization for the platform account to require 2 signatures for any transfers.',
  })
  @ApiResponse({
    status: 200,
    description: 'Multi-sig configuration set up successfully',
  })
  @ApiResponse({ status: 400, description: 'Multi-sig setup failed' })
  @ApiResponse({ status: 403, description: 'Forbidden: Admins only' })
  async setupPlatformMultiSig(@Req() req: Request) {
    const caller = req.user as User;
    if (caller.role !== 'admin') {
      throw new HttpException(
        'Only admins can configure platform wallet security',
        HttpStatus.FORBIDDEN,
      );
    }

    try {
      const result = await this.stellarService.setupPlatformMultiSig();
      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Multi-sig setup failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Returns the current multi-signature configuration of the platform fee wallet.
   * Used for auditing and verifying the multi-sig setup.
   * Issue #352 — Stellar multi-signature setup for platform fee wallet.
   * Only accessible by admin users.
   */
  @Get('platform-wallet/multisig-config')
  @ApiOperation({
    summary: 'Get multi-signature configuration of platform wallet',
    description: 'Returns the current signers and thresholds configured on the platform account for audit purposes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Multi-sig configuration retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Failed to retrieve configuration' })
  @ApiResponse({ status: 403, description: 'Forbidden: Admins only' })
  async getPlatformMultiSigConfig(@Req() req: Request) {
    const caller = req.user as User;
    if (caller.role !== 'admin') {
      throw new HttpException(
        'Only admins can view platform wallet configuration',
        HttpStatus.FORBIDDEN,
      );
    }

    try {
      const config = await this.stellarService.getPlatformMultiSigConfig();
      return {
        success: true,
        data: config,
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to retrieve configuration',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Returns paginated transaction logs using cursor-based pagination.
   * Issue #740 — Cursor-Based Pagination for Transaction Logs
   */
  @Get('logs')
  @ApiOperation({
    summary: 'Get transaction logs with cursor-based pagination',
    description: 'Returns paginated transaction logs using limit and cursor parameters.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of logs to return (default 20, max 100)' })
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'Cursor token for pagination' })
  @ApiResponse({ status: 200, description: 'Transaction logs retrieved successfully' })
  async getTransactionLogs(
    @Req() req: Request,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    const caller = req.user as User;
    const userId = caller.role === 'admin' ? undefined : caller.id;
    return this.stellarService.getTransactionLogs(userId, limit, cursor);
  }
}
