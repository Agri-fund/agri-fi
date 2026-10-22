import { Module } from '@nestjs/common';
import { SocialProofController } from './social-proof.controller';
import { SocialProofService } from './social-proof.service';

@Module({
  controllers: [SocialProofController],
  providers: [SocialProofService],
  exports: [SocialProofService],
})
export class SocialProofModule {}
