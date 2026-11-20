import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DidService } from './did.service';
import { DidController } from './did.controller';
import { DidDocument } from './entities/did-document.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DidDocument])],
  controllers: [DidController],
  providers: [DidService],
  exports: [DidService],
})
export class DidModule {}
