import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.guard';
import { SorobanService } from './soroban.service';
import { ApproveCampaignDto } from './dto/approve-campaign.dto';
import { ReleaseMilestoneDto } from './dto/release-milestone.dto';
import { DistributeRevenueDto } from './dto/distribute-revenue.dto';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto';

@ApiTags('soroban')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('soroban')
export class SorobanController {
  constructor(private readonly sorobanService: SorobanService) {}

  @Get('campaign/:contractId/state')
  @ApiOperation({ summary: 'Get on-chain campaign state' })
  async getCampaignState(@Param('contractId') contractId: string) {
    return this.sorobanService.getCampaignState(contractId);
  }

  @Get('campaign/:contractId/investor/:address/ownership')
  @ApiOperation({ summary: 'Get investor ownership percentage (basis points)' })
  async getOwnership(
    @Param('contractId') contractId: string,
    @Param('address') address: string,
  ) {
    const bps = await this.sorobanService.getInvestorOwnership(contractId, address);
    return { ownershipBps: bps, ownershipPct: (bps / 100).toFixed(2) };
  }

  @Post('campaign/:contractId/approve')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: approve funded campaign on-chain' })
  async approveCampaign(@Param('contractId') contractId: string) {
    const txHash = await this.sorobanService.approveCampaign(contractId);
    return { txHash };
  }

  @Post('campaign/:contractId/milestone')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: release a milestone tranche to farmer' })
  async releaseMilestone(
    @Param('contractId') contractId: string,
    @Body() dto: ReleaseMilestoneDto,
  ) {
    const txHash = await this.sorobanService.releaseMilestone(contractId, dto.milestoneIndex);
    return { txHash };
  }

  @Post('campaign/:contractId/distribute')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: distribute harvest revenue to investors' })
  async distributeRevenue(
    @Param('contractId') contractId: string,
    @Body() dto: DistributeRevenueDto,
  ) {
    const txHash = await this.sorobanService.distributeRevenue(
      contractId,
      BigInt(dto.revenueAmountStroops),
    );
    return { txHash };
  }

  @Post('campaign/:contractId/pause')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: emergency pause campaign' })
  async pauseCampaign(@Param('contractId') contractId: string) {
    const txHash = await this.sorobanService.pauseCampaign(contractId);
    return { txHash };
  }

  @Post('campaign/:contractId/fail')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: mark campaign as failed (enables refunds)' })
  async failCampaign(@Param('contractId') contractId: string) {
    const txHash = await this.sorobanService.markCampaignFailed(contractId);
    return { txHash };
  }

  @Get('factory/:contractId/campaign/:dealId')
  @ApiOperation({ summary: 'Get campaign entry from ProjectFactory registry' })
  async getFactoryCampaign(
    @Param('contractId') contractId: string,
    @Param('dealId') dealId: string,
  ) {
    return this.sorobanService.getCampaignFromFactory(contractId, dealId);
  }

  @Post('marketplace/:contractId/confirm')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: confirm delivery and trigger settlement' })
  async confirmDelivery(
    @Param('contractId') contractId: string,
    @Body() dto: ConfirmDeliveryDto,
  ) {
    const txHash = await this.sorobanService.confirmMarketplaceDelivery(contractId, dto.orderId);
    return { txHash };
  }

  @Post('marketplace/:contractId/refund')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: refund buyer (dispute resolution)' })
  async refundBuyer(
    @Param('contractId') contractId: string,
    @Body() dto: ConfirmDeliveryDto,
  ) {
    const txHash = await this.sorobanService.refundMarketplaceBuyer(contractId, dto.orderId);
    return { txHash };
  }

  @Get('marketplace/:contractId/order/:orderId')
  @ApiOperation({ summary: 'Get marketplace order state on-chain' })
  async getOrder(
    @Param('contractId') contractId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.sorobanService.getMarketplaceOrder(contractId, orderId);
  }
}
