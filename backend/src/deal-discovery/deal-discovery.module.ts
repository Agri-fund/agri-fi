import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedSearch } from './entities/saved-search.entity';
import { SearchHistory } from './entities/search-history.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { DealDiscoveryService } from './deal-discovery.service';
import { DealDiscoveryController } from './deal-discovery.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SavedSearch, SearchHistory, TradeDeal, User]),
    NotificationsModule,
  ],
  controllers: [DealDiscoveryController],
  providers: [DealDiscoveryService],
})
export class DealDiscoveryModule {}
