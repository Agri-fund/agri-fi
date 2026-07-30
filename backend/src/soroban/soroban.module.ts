import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SorobanService } from './soroban.service';
import { SorobanController } from './soroban.controller';
import { SorobanListenerService } from './soroban-listener.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([TradeDeal]),
    // AuthModule exports MfaGuard, RolesGuard, and User repository used by
    // @UseGuards on SorobanController admin routes.
    AuthModule,
  ],
  controllers: [SorobanController],
  providers: [SorobanService, SorobanListenerService],
  exports: [SorobanService],
})
export class SorobanModule {}
