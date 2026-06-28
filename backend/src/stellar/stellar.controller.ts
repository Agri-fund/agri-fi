import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
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
@Controller('stellar')
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
}
