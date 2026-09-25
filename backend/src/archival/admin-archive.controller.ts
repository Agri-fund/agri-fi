import {
  Controller,
  Get,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TradeDealArchive } from './entities/trade-deal-archive.entity';
import { InvestmentArchive } from './entities/investment-archive.entity';
import { ShipmentMilestoneArchive } from './entities/shipment-milestone-archive.entity';

@ApiTags('admin-archive')
@Controller('admin/archive')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@ApiBearerAuth('jwt')
export class AdminArchiveController {
  constructor(
    @InjectRepository(TradeDealArchive)
    private readonly dealArchiveRepo: Repository<TradeDealArchive>,
    @InjectRepository(InvestmentArchive)
    private readonly investmentArchiveRepo: Repository<InvestmentArchive>,
    @InjectRepository(ShipmentMilestoneArchive)
    private readonly milestoneArchiveRepo: Repository<ShipmentMilestoneArchive>,
  ) {}

  @Get('deals')
  @ApiOperation({
    summary: 'Query archived trade deals by year range (admin only)',
  })
  @ApiQuery({
    name: 'startYear',
    required: false,
    type: Number,
    description: 'Start year (e.g. 2020)',
  })
  @ApiQuery({
    name: 'endYear',
    required: false,
    type: Number,
    description: 'End year (e.g. 2024)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default 20)',
  })
  @ApiResponse({ status: 200, description: 'Archived deals list' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async getArchivedDeals(
    @Query('startYear') startYear?: string,
    @Query('endYear') endYear?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    const where: any = {};

    if (startYear || endYear) {
      const start = startYear
        ? new Date(`${startYear}-01-01T00:00:00.000Z`)
        : new Date('1970-01-01');
      const end = endYear
        ? new Date(`${endYear}-12-31T23:59:59.999Z`)
        : new Date('2099-12-31');
      where.createdAt = Between(start, end);
    }

    const skip = (page - 1) * limit;
    const [data, total] = await this.dealArchiveRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit };
  }

  @Get('investments')
  @ApiOperation({ summary: 'Query archived investments (admin only)' })
  @ApiQuery({ name: 'tradeDealId', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Archived investments list' })
  async getArchivedInvestments(
    @Query('tradeDealId') tradeDealId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    const where: any = tradeDealId ? { tradeDealId } : {};
    const skip = (page - 1) * limit;
    const [data, total] = await this.investmentArchiveRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit };
  }

  @Get('shipments')
  @ApiOperation({ summary: 'Query archived shipment milestones (admin only)' })
  @ApiQuery({ name: 'tradeDealId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Archived milestones list' })
  async getArchivedMilestones(@Query('tradeDealId') tradeDealId?: string) {
    const where: any = tradeDealId ? { tradeDealId } : {};
    return this.milestoneArchiveRepo.find({
      where,
      order: { recordedAt: 'DESC' },
    });
  }
}
