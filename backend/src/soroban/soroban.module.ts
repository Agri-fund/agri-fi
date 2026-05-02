import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SorobanService } from './soroban.service';
import { SorobanController } from './soroban.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [SorobanController],
  providers: [SorobanService],
  exports: [SorobanService],
})
export class SorobanModule {}
