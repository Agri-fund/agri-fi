import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ShipmentsService } from './shipments.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('shipments')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Get(':trade_deal_id')
  @ApiOperation({ summary: 'List shipment milestones for a trade deal' })
  @ApiParam({ name: 'trade_deal_id', description: 'Trade deal UUID' })
  @ApiResponse({ status: 200, description: 'Ordered list of milestones' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async getMilestonesByDeal(@Param('trade_deal_id') tradeDealId: string) {
    return this.shipmentsService.findByDeal(tradeDealId);
  }

  @Post('milestones')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a shipment milestone (trader only)' })
  @ApiResponse({ status: 201, description: 'Milestone recorded' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or milestone out of sequence',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Only traders can record milestones',
  })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async recordMilestone(
    @Request() req: AuthRequest,
    @Body() dto: CreateMilestoneDto,
  ) {
    const user: User = req.user;
    if (user.role !== 'trader') {
      throw new ForbiddenException({
        code: 'ROLE_REQUIRED',
        message: 'Only traders can record milestones.',
      });
    }
    return this.shipmentsService.recordMilestone(user.id, dto);
  }
}
