import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { KycGuard } from '../auth/kyc.guard';
import { InvestmentsService } from './investments.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { User } from '../auth/entities/user.entity';

@Controller('investments')
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), KycGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateInvestmentDto,
    @Request() req: { user: User },
  ) {
    return this.investmentsService.create(dto, req.user);
  }
}
