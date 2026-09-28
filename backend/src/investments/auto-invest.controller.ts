import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Query,
  ForbiddenException,
  ParseIntPipe,
  DefaultValuePipe,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AutoInvestService } from './auto-invest.service';
import {
  CreateAutoInvestPlanDto,
  UpdateAutoInvestPlanDto,
  PauseAutoInvestPlanDto,
} from './dto/auto-invest-plan.dto';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('auto-invest')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'auto-invest/plans', version: '1' })
export class AutoInvestController {
  constructor(private readonly autoInvestService: AutoInvestService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a recurring auto-invest plan (#1001)' })
  @ApiResponse({ status: 201, description: 'Plan created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'KYC not approved or not an investor' })
  async create(@Request() req: AuthRequest, @Body() dto: CreateAutoInvestPlanDto) {
    const user: User = req.user;
    if (user.role !== 'investor') {
      throw new ForbiddenException('Only investors can create auto-invest plans.');
    }
    return this.autoInvestService.createPlan(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all auto-invest plans for the authenticated investor' })
  @ApiResponse({ status: 200, description: 'List of plans' })
  async findMine(@Request() req: AuthRequest) {
    return this.autoInvestService.findByInvestor((req.user as User).id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific auto-invest plan' })
  @ApiParam({ name: 'id', description: 'Plan UUID' })
  @ApiResponse({ status: 200, description: 'Plan details' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async findOne(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.autoInvestService.findOne(id, (req.user as User).id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an auto-invest plan' })
  @ApiParam({ name: 'id', description: 'Plan UUID' })
  @ApiResponse({ status: 200, description: 'Plan updated' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  @ApiResponse({ status: 409, description: 'Cannot update a cancelled plan' })
  async update(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: UpdateAutoInvestPlanDto,
  ) {
    return this.autoInvestService.updatePlan(id, (req.user as User).id, dto);
  }

  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause or resume an auto-invest plan' })
  @ApiParam({ name: 'id', description: 'Plan UUID' })
  @ApiResponse({ status: 200, description: 'Plan status updated' })
  async togglePause(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: PauseAutoInvestPlanDto,
  ) {
    return this.autoInvestService.pausePlan(id, (req.user as User).id, dto.paused);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel (soft-delete) an auto-invest plan' })
  @ApiParam({ name: 'id', description: 'Plan UUID' })
  @ApiResponse({ status: 204, description: 'Plan cancelled' })
  async cancel(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.autoInvestService.cancelPlan(id, (req.user as User).id);
  }

  // ─── Admin oversight ────────────────────────────────────────────────────

  @Get('admin/all')
  @ApiOperation({ summary: '[Admin] List all auto-invest plans across investors' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'Paginated list of all plans' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async adminList(
    @Request() req: AuthRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const user: User = req.user;
    if (user.role !== 'admin' && user.role !== 'company_admin') {
      throw new ForbiddenException('Admin access required.');
    }
    return this.autoInvestService.adminListPlans(page, Math.min(limit, 100));
  }
}
