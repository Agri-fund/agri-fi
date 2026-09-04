import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ApiKeyService, GeneratedApiKeyResponse } from './api-key.service';
import { ApiKey, ApiKeyScope } from './entities/api-key.entity';

export class CreateApiKeyDto {
  label: string;
  scopes: ApiKeyScope[];
  expiresInDays?: number;
}

@ApiTags('API Keys')
@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  @ApiOperation({
    summary: 'Create new API key for M2M communication (raw key returned once)',
  })
  async createKey(
    @Req() req: any,
    @Body() dto: CreateApiKeyDto,
  ): Promise<GeneratedApiKeyResponse> {
    const ownerId = req.user?.id || 'm2m-admin-uuid';
    return await this.apiKeyService.createApiKey(
      ownerId,
      dto.label,
      dto.scopes,
      dto.expiresInDays,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List API keys owned by user with masked values' })
  async listKeys(@Req() req: any): Promise<Omit<ApiKey, 'hashedKey'>[]> {
    const ownerId = req.user?.id || 'm2m-admin-uuid';
    return await this.apiKeyService.listKeys(ownerId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an active API key' })
  async revokeKey(@Req() req: any, @Param('id') id: string): Promise<void> {
    const ownerId = req.user?.id || 'm2m-admin-uuid';
    await this.apiKeyService.revokeKey(ownerId, id);
  }
}
