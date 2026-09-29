import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../common/guards';
import { KycRulesService } from './kyc-rules.service';
import {
  CreateKycJurisdictionRuleDto,
  UpdateKycJurisdictionRuleDto,
} from './dto/kyc-jurisdiction-rule.dto';
import { KycCustomerType } from './entities/kyc-jurisdiction-rule.entity';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('Admin - KYC Jurisdiction Rules')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller({ path: 'admin/kyc-rules', version: '1' })
export class AdminKycRulesController {
  constructor(private readonly kycRulesService: KycRulesService) {}

  @Get()
  @ApiOperation({ summary: 'List KYC jurisdiction rules' })
  @ApiResponse({ status: 200, description: 'Rules list' })
  async list(
    @Query('countryCode') countryCode?: string,
    @Query('customerType') customerType?: KycCustomerType,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.kycRulesService.list({
      countryCode,
      customerType,
      activeOnly: activeOnly !== 'false',
    });
  }

  @Get('matrix')
  @ApiOperation({ summary: 'Get active KYC rules matrix by country' })
  async matrix() {
    return this.kycRulesService.getMatrix();
  }

  @Post()
  @ApiOperation({
    summary: 'Create (version) a KYC jurisdiction rule',
    description:
      'Creates a new version and deactivates the previous active rule for the same country/type.',
  })
  @ApiResponse({ status: 201, description: 'Rule created' })
  async create(
    @Request() req: AuthRequest,
    @Body() dto: CreateKycJurisdictionRuleDto,
  ) {
    return this.kycRulesService.create(dto, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a KYC jurisdiction rule (audited)' })
  async update(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: UpdateKycJurisdictionRuleDto,
  ) {
    return this.kycRulesService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a KYC jurisdiction rule (audited)' })
  async deactivate(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body('changeReason') changeReason: string,
  ) {
    return this.kycRulesService.deactivate(id, changeReason, req.user.id);
  }
}
