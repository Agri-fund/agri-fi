import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpgradeService } from './upgrade.service';
import { IsString, MinLength } from 'class-validator';

class PlanUpgradeDto {
  @IsString()
  contractName: string;

  @IsString()
  @MinLength(1)
  newWasmPath: string;
}

class ApproveUpgradeDto {
  @IsString()
  @MinLength(1)
  signature: string;
}

@ApiTags('admin/upgrades')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@Controller('admin/upgrades')
export class UpgradeController {
  constructor(private readonly upgradeService: UpgradeService) {}

  @Get('deployments')
  @ApiOperation({ summary: 'List all Soroban contract deployment history' })
  @ApiResponse({ status: 200, description: 'Deployment history' })
  getAllDeployments() {
    return this.upgradeService.getDeploymentHistory();
  }

  @Get('deployments/:contractName')
  @ApiOperation({ summary: 'Deployment history for a specific contract' })
  getDeploymentsByContract(@Param('contractName') contractName: string) {
    return this.upgradeService.getDeploymentHistory(contractName);
  }

  @Post('plan')
  @ApiOperation({ summary: 'Plan a contract upgrade with WASM validation' })
  planUpgrade(
    @Request() req: { user: { id: string } },
    @Body() dto: PlanUpgradeDto,
  ) {
    return this.upgradeService.planUpgrade(
      dto.contractName,
      dto.newWasmPath,
      req.user.id,
    );
  }

  @Post(':planId/approve')
  @ApiOperation({
    summary: 'Multi-sig approval for production upgrade (2-of-3)',
  })
  approveUpgrade(
    @Request() req: { user: { id: string } },
    @Param('planId') planId: string,
    @Body() dto: ApproveUpgradeDto,
  ) {
    return this.upgradeService.approveUpgrade(
      planId,
      req.user.id,
      dto.signature,
    );
  }

  @Post(':planId/execute')
  @ApiOperation({ summary: 'Execute an approved contract upgrade' })
  executeUpgrade(
    @Request() req: { user: { id: string } },
    @Param('planId') planId: string,
  ) {
    return this.upgradeService.executeUpgrade(planId, req.user.id);
  }

  @Post(':planId/rollback')
  @ApiOperation({ summary: 'Rollback a failed upgrade to previous WASM' })
  rollback(
    @Request() req: { user: { id: string } },
    @Param('planId') planId: string,
  ) {
    return this.upgradeService.rollback(planId, req.user.id);
  }
}
