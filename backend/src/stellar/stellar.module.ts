import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StellarService } from './stellar.service';
import { StellarController } from './stellar.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [StellarController],
  providers: [StellarService],
  exports: [StellarService],
})
export class StellarModule {}
