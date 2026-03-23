import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InvestmentsService } from './investments.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { SubmitTransactionDto } from './dto/submit-transaction.dto';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@Controller('investments')
@UseGuards(AuthGuard('jwt'))
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Post()
  async createInvestment(
    @Request() req: AuthRequest,
    @Body() dto: CreateInvestmentDto,
  ) {
    return this.investmentsService.createInvestment(req.user.id, dto);
  }

  @Post(':id/submit-tx')
  async submitTransaction(
    @Param('id') investmentId: string,
    @Request() req: AuthRequest,
    @Body() dto: SubmitTransactionDto,
  ) {
    return this.investmentsService.submitTransaction(
      investmentId,
      req.user.id,
      dto.signedXdr,
    );
  }
}