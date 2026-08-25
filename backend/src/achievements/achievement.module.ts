import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Achievement } from './entities/achievement.entity';
import { Investment } from '../investments/entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { AchievementService } from './achievement.service';
import { AchievementController } from './achievement.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Achievement, Investment, TradeDeal, User]),
  ],
  providers: [AchievementService],
  controllers: [AchievementController],
  exports: [AchievementService],
})
export class AchievementModule {}
