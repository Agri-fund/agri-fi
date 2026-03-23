import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment } from '../users/entities/investment.entity';
import { TradeDeal } from '../users/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { StellarService } from '../stellar/stellar.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';

@Injectable()
export class InvestmentsService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepository: Repository<Investment>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepository: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly stellarService: StellarService,
  ) {}

  async createInvestment(userId: string, dto: CreateInvestmentDto) {
    // Verify user exists and has wallet
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.walletAddress) {
      throw new BadRequestException('User must have a linked wallet address');
    }
    if (user.role !== 'investor') {
      throw new ForbiddenException('Only investors can create investments');
    }

    // Verify trade deal exists and is open
    const tradeDeal = await this.tradeDealRepository.findOne({
      where: { id: dto.tradeDealId },
      relations: ['investments'],
    });
    if (!tradeDeal) {
      throw new NotFoundException('Trade deal not found');
    }
    if (tradeDeal.status !== 'open') {
      throw new BadRequestException('Trade deal is not open for investment');
    }

    // Calculate remaining tokens
    const totalInvested = tradeDeal.investments.reduce(
      (sum, inv) => sum + (inv.status === 'confirmed' ? inv.tokenAmount : 0),
      0,
    );
    const tokensRemaining = tradeDeal.tokenCount - totalInvested;

    if (dto.tokenAmount > tokensRemaining) {
      throw new BadRequestException(
        `Only ${tokensRemaining} tokens remaining for this deal`,
      );
    }

    // Calculate USD amount
    const amountUsd = dto.tokenAmount * 100; // $100 per token

    // Create pending investment record
    const investment = this.investmentRepository.create({
      tradeDealId: dto.tradeDealId,
      investorId: userId,
      tokenAmount: dto.tokenAmount,
      amountUsd,
      status: 'pending',
    });

    const savedInvestment = await this.investmentRepository.save(investment);

    // Generate unsigned XDR for the investment transaction
    const unsignedXdr = await this.stellarService.createInvestmentTransaction(
      user.walletAddress,
      tradeDeal.escrowAccount,
      amountUsd,
      tradeDeal.assetCode,
      dto.tokenAmount,
    );

    return {
      id: savedInvestment.id,
      unsignedXdr,
      tokenAmount: dto.tokenAmount,
      amountUsd,
    };
  }

  async submitTransaction(
    investmentId: string,
    userId: string,
    signedXdr: string,
  ) {
    // Find the investment
    const investment = await this.investmentRepository.findOne({
      where: { id: investmentId, investorId: userId },
      relations: ['tradeDeal'],
    });

    if (!investment) {
      throw new NotFoundException('Investment not found');
    }

    if (investment.status !== 'pending') {
      throw new BadRequestException('Investment is not in pending status');
    }

    try {
      // Submit the signed transaction to Stellar network
      const txResult = await this.stellarService.submitTransaction(signedXdr);

      // Update investment with transaction ID and confirm status
      investment.stellarTxId = txResult.hash;
      investment.status = 'confirmed';
      await this.investmentRepository.save(investment);

      // Check if deal is now fully funded
      const tradeDeal = await this.tradeDealRepository.findOne({
        where: { id: investment.tradeDealId },
        relations: ['investments'],
      });

      if (tradeDeal) {
        const totalInvested = tradeDeal.investments.reduce(
          (sum, inv) => sum + (inv.status === 'confirmed' ? inv.tokenAmount : 0),
          0,
        );

        if (totalInvested >= tradeDeal.tokenCount) {
          tradeDeal.status = 'funded';
          await this.tradeDealRepository.save(tradeDeal);
        }
      }

      return {
        id: investment.id,
        status: investment.status,
        stellarTxId: investment.stellarTxId,
        tokenAmount: investment.tokenAmount,
        amountUsd: investment.amountUsd,
      };
    } catch (error) {
      // Mark investment as failed
      investment.status = 'failed';
      await this.investmentRepository.save(investment);

      throw new BadRequestException(
        `Transaction submission failed: ${error.message}`,
      );
    }
  }
}