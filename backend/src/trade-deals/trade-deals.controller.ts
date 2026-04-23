import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TradeDealsService } from './trade-deals.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { KycGuard } from '../auth/kyc.guard';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { CreateTradeDealDto } from './dto/create-trade-deal.dto';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';

interface AuthRequest extends Request {
  user: User;
}

@Controller('trade-deals')
export class TradeDealsController {
  constructor(
    private readonly tradeDealsService: TradeDealsService,
    private readonly stellarService: StellarService,
    private readonly queueService: QueueService,
  ) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), KycGuard)
  async createDeal(
    @Request() req: AuthRequest,
    @Body() dto: CreateTradeDealDto,
  ): Promise<TradeDeal> {
    if (req.user.role !== 'trader') {
      throw new ForbiddenException({
        code: 'ROLE_REQUIRED',
        message: 'Only traders can create trade deals.',
      });
    }

    return this.tradeDealsService.createDeal(req.user.id, dto);
  }

  @Post(':id/publish')
  @UseGuards(AuthGuard('jwt'), KycGuard)
  async publishDeal(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ): Promise<TradeDeal> {
    if (req.user.role !== 'trader') {
      throw new ForbiddenException({
        code: 'ROLE_REQUIRED',
        message: 'Only traders can publish trade deals.',
      });
    }

    const deal = await this.tradeDealsService.publishDeal(id, req.user.id);

    const { publicKey, secretKey } = await this.stellarService.createEscrowAccount(id);

    await this.tradeDealsService.updateDealStatus(id, 'open');
    await this.tradeDealsService.saveEscrowKeys(id, publicKey, secretKey);

    await this.queueService.enqueueDealPublish({
      dealId: id,
      tokenSymbol: deal.tokenSymbol,
      escrowPublicKey: publicKey,
      escrowSecretKey: secretKey,
      tokenCount: deal.tokenCount,
    });

    deal.status = 'open';
    deal.escrowPublicKey = publicKey;
    return deal;
  }

  @Get()
  async findOpen(
    @Query('commodity') commodity?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<any[]> {
    return this.tradeDealsService.findOpen({
      commodity,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @UseGuards(OptionalJwtGuard)
  async findOne(@Param('id') id: string): Promise<any> {
    return this.tradeDealsService.findOne(id);
  }
}
