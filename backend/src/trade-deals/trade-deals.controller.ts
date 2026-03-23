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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TradeDealsService } from './trade-deals.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@Controller('trade-deals')
@UseGuards(AuthGuard('jwt'))
export class TradeDealsController {
  constructor(private readonly tradeDealsService: TradeDealsService) {}

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<TradeDeal> {
    return this.tradeDealsService.findOne(id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publishDeal(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ): Promise<TradeDeal> {
    return this.tradeDealsService.publishDeal(id, req.user.id);
  }
}
