import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccreditationService } from './accreditation.service';
import { AccreditationController } from './accreditation.controller';
import { AccreditationCronService } from './accreditation-cron.service';
import { AnnualCapService } from './annual-cap.service';
import { AnnualInvestmentTotal } from './entities/annual-investment-total.entity';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnnualInvestmentTotal, User]),
    AuthModule,
  ],
  controllers: [AccreditationController],
  providers: [AccreditationService, AnnualCapService, AccreditationCronService],
  exports: [AccreditationService, AnnualCapService],
})
export class AccreditationModule {}
