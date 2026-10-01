import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { KycRulesService } from './kyc-rules.service';
import { KycCustomerType } from './entities/kyc-jurisdiction-rule.entity';

@ApiTags('kyc-rules')
@Controller({ path: 'kyc', version: '1' })
export class KycRulesController {
  constructor(private readonly kycRulesService: KycRulesService) {}

  @Get('requirements')
  @ApiOperation({
    summary:
      'Dynamic KYC form metadata for a country / customer type (#1019)',
  })
  @ApiQuery({ name: 'country', required: true, example: 'NG' })
  @ApiQuery({
    name: 'customerType',
    required: false,
    enum: KycCustomerType,
  })
  @ApiResponse({ status: 200, description: 'Form metadata for dynamic KYC UI' })
  @ApiResponse({ status: 404, description: 'No rules for jurisdiction' })
  async getRequirements(
    @Query('country') country: string,
    @Query('customerType') customerType?: KycCustomerType,
  ) {
    return this.kycRulesService.getFormMetadata(
      country,
      customerType ?? KycCustomerType.INDIVIDUAL,
    );
  }

  @Get('matrix')
  @ApiOperation({
    summary: 'Full active KYC jurisdiction rules matrix (#1019)',
  })
  @ApiResponse({ status: 200, description: 'Country → customer-type matrix' })
  async getMatrix() {
    return this.kycRulesService.getMatrix();
  }
}
