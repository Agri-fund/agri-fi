import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { StellarService } from './stellar.service';

@ApiTags('stellar')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller('stellar')
export class StellarController {
  constructor(private readonly stellarService: StellarService) {}

  /**
   * Submits a pre-signed XDR transaction to the Stellar network.
   * Used by the frontend after the user signs a transaction with Freighter or Albedo.
   * Issue #83 — Client-Side Signing; Issue #88 — Secondary Market
   */
  @Post('submit')
  @HttpCode(HttpStatus.OK)
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
  @ApiResponse({ status: 200, description: 'Transaction submitted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid XDR or transaction rejected' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async submitTransaction(@Body('signedXdr') signedXdr: string) {
    const result = await this.stellarService.submitTransaction(signedXdr);
    return { hash: result?.hash ?? (result as any)?.id, success: true };
  }
}
