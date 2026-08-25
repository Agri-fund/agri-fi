import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  Body,
  Query,
  NotFoundException,
  BadRequestException,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { ApiBody } from '@nestjs/swagger';
import { IsIn, IsString, IsBoolean, IsUUID } from 'class-validator';
import { Roles, RolesGuard } from './roles.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { StellarService } from '../stellar/stellar.service';

class UpdateUserRoleDto {
  @IsIn(['farmer', 'trader', 'investor', 'company_admin', 'admin'])
  role: 'farmer' | 'trader' | 'investor' | 'company_admin' | 'admin';
}

class FreezeAssetDto {
  @IsUUID()
  tradeDealId: string;

  @IsString()
  trustorWallet: string;

  @IsBoolean()
  freeze: boolean;
}

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('admin')
@Version('1')
@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@ApiBearerAuth('jwt')
export class AdminController {
  constructor(
    private readonly authService: AuthService,
    private readonly stellarService: StellarService,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
  ) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users (admin only)' })
  @ApiResponse({ status: 200, description: 'List of users' })
  async listUsers(@Query('page') page = '1', @Query('limit') limit = '100') {
    return this.authService.listUsers(parseInt(page), parseInt(limit));
  }

  @Post('kyc/:userId/approve')
  @ApiOperation({ summary: 'Approve a user KYC submission' })
  @ApiResponse({ status: 200, description: 'KYC approved' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'User or submission not found' })
  async approveKyc(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
  ) {
    return this.authService.approveKyc(userId);
  }

  @Post('kyc/:id/approve-corporate')
  @ApiOperation({ summary: 'Approve a corporate KYC submission by id' })
  @ApiResponse({ status: 200, description: 'Corporate KYC approved' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  async approveCorporateKyc(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    return this.authService.approveCorporateKycSubmission(id);
  }

  @Post('users/:userId/role')
  @ApiOperation({ summary: 'Update a user role and invalidate old tokens' })
  @ApiBody({ type: UpdateUserRoleDto })
  async updateUserRole(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.authService.updateUserRole(userId, dto.role);
  }

  @Post('freeze-asset')
  @ApiOperation({
    summary: 'Freeze or unfreeze an investor trustline for a trade asset (AML compliance)',
  })
  @ApiBody({ type: FreezeAssetDto })
  @ApiResponse({ status: 201, description: 'Trustline freeze/unfreeze submitted', schema: { properties: { txId: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Issuer keys not available for this deal' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async freezeAsset(@Body() dto: FreezeAssetDto) {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dto.tradeDealId },
    });
    if (!deal) {
      throw new NotFoundException(`Trade deal ${dto.tradeDealId} not found`);
    }
    if (!deal.issuerPublicKey || !deal.issuerSecretKey) {
      throw new BadRequestException(
        `Issuer keys not available for deal ${dto.tradeDealId}`,
      );
    }

    const issuerSecret = this.stellarService.decryptSecret(deal.issuerSecretKey);
    const txId = await this.stellarService.freezeAsset(
      issuerSecret,
      deal.tokenSymbol,
      deal.issuerPublicKey,
      dto.trustorWallet,
      dto.freeze,
    );

    return { txId };
  }
}
