import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('farmer_credit_score_history')
export class FarmerCreditScoreHistory {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique history entry ID' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ApiProperty({ description: 'Farmer User UUID' })
  userId: string;

  @Column({ type: 'int' })
  @ApiProperty({ description: 'Calculated credit score (300-850)', example: 745 })
  score: number;

  @Column({ name: 'max_deal_size_usdc', type: 'decimal', precision: 12, scale: 2 })
  @ApiProperty({ description: 'Maximum uncollateralized deal size limit in USDC' })
  maxDealSizeUsdc: number;

  @Column({ type: 'simple-json' })
  @ApiProperty({
    description: 'Breakdown of scoring factor components and percentages',
    example: {
      onTimeRepaymentRate: 0.95,
      dealCompletionRate: 1.0,
      dealDefaultRate: 0.0,
      shipmentMilestoneComplianceRate: 0.92,
      kycVerificationAgeDays: 180,
    },
  })
  factors: {
    onTimeRepaymentRate: number;
    dealCompletionRate: number;
    dealDefaultRate: number;
    shipmentMilestoneComplianceRate: number;
    kycVerificationAgeDays: number;
  };

  @Column({ type: 'varchar', length: 255 })
  @ApiProperty({ description: 'Triggering event or recalculation reason' })
  reason: string;

  @Column({ name: 'override_by', type: 'uuid', nullable: true })
  @ApiProperty({ description: 'Admin user ID if manually overridden', nullable: true })
  overrideBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
