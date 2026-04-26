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
import { TransactionBuilder, Networks, FeeBumpTransaction } from 'stellar-sdk';

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
    const network = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
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
      sourceAccount = transaction instanceof FeeBumpTransaction
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
    const result = await this.stellarService.submitTransaction(signedXdr);
    return { hash: result?.hash ?? (result as any)?.id, success: true };
  }
}
