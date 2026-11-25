import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DealDiscoveryService } from './deal-discovery.service';
import { CreateSavedSearchDto, RecordSearchDto } from './dto/saved-search.dto';

/** Saved searches, search history and deal comparison for the marketplace (#1149). */
@ApiTags('deal-discovery')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ version: '1', path: 'deal-discovery' })
export class DealDiscoveryController {
  constructor(private readonly service: DealDiscoveryService) {}

  @Get('saved-searches')
  @ApiOperation({ summary: 'List my saved searches' })
  listSaved(@CurrentUser('id') userId: string) {
    return this.service.listSaved(userId);
  }

  @Post('saved-searches')
  @ApiOperation({ summary: 'Save a search, optionally with new-match alerts' })
  createSaved(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSavedSearchDto,
  ) {
    return this.service.createSaved(userId, dto);
  }

  @Delete('saved-searches/:id')
  async deleteSaved(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deleteSaved(userId, id);
    return { ok: true };
  }

  @Get('history')
  @ApiOperation({ summary: 'My most recent searches' })
  listHistory(@CurrentUser('id') userId: string) {
    return this.service.listHistory(userId);
  }

  @Post('history')
  @ApiOperation({ summary: 'Record a search in my history' })
  recordHistory(
    @CurrentUser('id') userId: string,
    @Body() dto: RecordSearchDto,
  ) {
    return this.service.recordHistory(userId, dto);
  }

  @Delete('history')
  async clearHistory(@CurrentUser('id') userId: string) {
    await this.service.clearHistory(userId);
    return { ok: true };
  }

  @Get('compare')
  @ApiOperation({ summary: 'Compare 2-3 deals side by side (ids=a,b,c)' })
  compare(@Query('ids') ids = '') {
    return this.service.compare(
      ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }
}
