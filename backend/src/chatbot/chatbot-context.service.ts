import { Injectable } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';

export interface UserContext {
  userId: string;
  userRole: string;
  recentDeals: TradeDeal[];
  recentInvestments: Investment[];
  isNewUser: boolean;
  preferredLanguage: string;
}

@Injectable()
export class ChatbotContextService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
  ) {}

  async getUserContext(userId: string): Promise<UserContext> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'role', 'createdAt', 'preferredLanguage'],
    });

    if (!user) {
      return {
        userId,
        userRole: 'unknown',
        recentDeals: [],
        recentInvestments: [],
        isNewUser: true,
        preferredLanguage: 'en',
      };
    }

    // Get user's recent deals
    const recentDeals = await this.dealRepo.find({
      where: [{ traderId: userId }, { farmerId: userId }],
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const recentInvestments = await this.investmentRepo.find({
      where: {
        investorId: userId,
        status: In([
          InvestmentStatus.CONFIRMED,
          InvestmentStatus.ACTIVE,
          InvestmentStatus.RELEASING,
          InvestmentStatus.COMPLETED,
        ]),
      },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const isNewUser = this.isNewUser(user.createdAt);

    return {
      userId,
      userRole: user.role,
      recentDeals,
      recentInvestments,
      isNewUser,
      preferredLanguage: user.preferredLanguage || 'en',
    };
  }

  async enrichUserContext(userId: string, input: string): Promise<any> {
    const context = await this.getUserContext(userId);

    // Detect if user is asking about a specific deal
    const dealMatch = input.match(/deal\s+#?(\w+)/i);
    let dealContext = null;

    if (dealMatch && context.recentDeals.length > 0) {
      const dealId = dealMatch[1];
      dealContext = context.recentDeals.find((d) => d.id.includes(dealId));
    }

    return {
      ...context,
      dealContext,
      input,
    };
  }

  private isNewUser(createdAt: Date): boolean {
    const daysSinceCreation = Math.floor(
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    return daysSinceCreation < 7;
  }

  getSuggestedTopics(userRole: string, isNewUser: boolean): string[] {
    const baseTopics = [
      'How to create a deal',
      'Track your shipment',
      'View investments',
      'Platform fees',
    ];

    const roleTopics: Record<string, string[]> = {
      trader: [
        'Create new trade deal',
        'Manage milestones',
        'Escrow information',
      ],
      farmer: [
        'Understand pricing',
        'Track harvest deals',
        'Settlement process',
      ],
      investor: ['View returns', 'Investment portfolio', 'Risk assessment'],
      logistics: ['Coordinate shipments', 'Track packages', 'Documentation'],
    };

    const newUserTopics = [
      'Getting started guide',
      'Account setup',
      'KYC requirements',
      'Platform tour',
    ];

    let topics = baseTopics;
    if (roleTopics[userRole]) {
      topics = topics.concat(roleTopics[userRole]);
    }
    if (isNewUser) {
      topics = newUserTopics.concat(topics);
    }

    return topics.slice(0, 5);
  }
}
