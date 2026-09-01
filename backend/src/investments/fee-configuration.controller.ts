import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FeeConfigurationService } from './fee-configuration.service';
import {
  CreateFeeConfigurationDto,
  UpdateFeeConfigurationDto,
  ListFeeConfigurationQueryDto,
} from './dto/fee-configuration.dto';
import { FeeConfiguration } from '../database/entities/fee-configuration.entity';
import { AdminGuard } from '../auth/guards/admin.guard';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQuery,
} from '../common/pagination';

@ApiTags('Admin - Fee Configuration')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/fee-configurations')
export class FeeConfigurationController {
  constructor(private readonly feeConfigService: FeeConfigurationService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new fee configuration',
    description:
      'Create a new fee configuration for a specific deal type, investor tier, and fee type combination.',
  })
  @ApiResponse({
    status: 201,
    description: 'Fee configuration created',
    type: FeeConfiguration,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 409, description: 'Configuration already exists' })
  async create(
    @Body() dto: CreateFeeConfigurationDto,
  ): Promise<FeeConfiguration> {
    return this.feeConfigService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List fee configurations',
    description:
      'List all fee configurations with optional filters and pagination.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of fee configurations',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/FeeConfiguration' },
        },
        total: { type: 'number' },
        skip: { type: 'number' },
        take: { type: 'number' },
      },
    },
  })
  async list(
    @Query() queryDto: ListFeeConfigurationQueryDto,
    @Query() paginationQuery: PaginationQuery,
  ): Promise<PaginatedResult<FeeConfiguration>> {
    const pagination = normalizePagination(paginationQuery);
    return this.feeConfigService.list(queryDto, pagination);
  }

  @Get('deal-types')
  @ApiOperation({
    summary: 'Get all deal types with fee configurations',
    description:
      'Returns a list of unique deal types that have fee configurations.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of deal types',
    schema: {
      type: 'array',
      items: { type: 'string' },
      example: ['Cocoa', 'Coffee', 'Maize'],
    },
  })
  async getDealTypes(): Promise<string[]> {
    return this.feeConfigService.getAllDealTypes();
  }

  @Get('matrix/:dealType')
  @ApiOperation({
    summary: 'Get fee configuration matrix',
    description:
      'Get a matrix of all fees for a specific deal type across all investor tiers.',
  })
  @ApiResponse({
    status: 200,
    description: 'Fee matrix for the deal type',
    schema: {
      type: 'object',
      example: {
        retail: {
          platform_origination: 2.0,
          platform_success: 0.5,
          investor_entry: 1.0,
          early_exit: 2.0,
        },
        vip: {
          platform_origination: 2.0,
          platform_success: 0.5,
          investor_entry: 0.5,
          early_exit: 2.0,
        },
        institutional: {
          platform_origination: 2.0,
          platform_success: 0.5,
          investor_entry: 0.0,
          early_exit: 2.0,
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No configurations found for deal type',
  })
  async getMatrix(
    @Param('dealType') dealType: string,
  ): Promise<Record<string, Record<string, number>>> {
    if (!dealType) {
      throw new BadRequestException('dealType is required');
    }
    return this.feeConfigService.getConfigurationMatrix(dealType);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fee configuration by ID' })
  @ApiResponse({
    status: 200,
    description: 'Fee configuration',
    type: FeeConfiguration,
  })
  @ApiResponse({ status: 404, description: 'Fee configuration not found' })
  async getById(@Param('id') id: string): Promise<FeeConfiguration> {
    return this.feeConfigService.findById(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update a fee configuration',
    description:
      'Update rate, description, or expiration date of a fee configuration.',
  })
  @ApiResponse({
    status: 200,
    description: 'Fee configuration updated',
    type: FeeConfiguration,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Fee configuration not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFeeConfigurationDto,
  ): Promise<FeeConfiguration> {
    return this.feeConfigService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a fee configuration',
    description:
      'Delete an inactive fee configuration. Active configurations must be expired first.',
  })
  @ApiResponse({ status: 204, description: 'Fee configuration deleted' })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete active configuration',
  })
  @ApiResponse({ status: 404, description: 'Fee configuration not found' })
  async delete(@Param('id') id: string): Promise<void> {
    await this.feeConfigService.delete(id);
  }
}
