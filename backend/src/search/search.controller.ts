import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { SearchService, SearchResultType } from './search.service';
import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

class SearchQueryDto {
  @IsString()
  q: string;

  @IsOptional()
  @IsString()
  types?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Unified full-text search across deals, farmers, and documents',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search query' })
  @ApiQuery({
    name: 'types',
    required: false,
    description: 'Comma-separated: deals,farmers,documents',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Ranked search results grouped by type',
  })
  async search(@Query() dto: SearchQueryDto) {
    const types = this.parseTypes(dto.types);
    return this.searchService.search(dto.q, types, dto.limit);
  }

  private parseTypes(raw?: string): SearchResultType[] {
    if (!raw) return ['deals', 'farmers', 'documents'];
    const valid: SearchResultType[] = ['deals', 'farmers', 'documents'];
    const parsed = raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t): t is SearchResultType =>
        valid.includes(t as SearchResultType),
      );
    return parsed.length > 0 ? parsed : ['deals', 'farmers', 'documents'];
  }
}
