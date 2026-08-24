import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum FeeType {
  PLATFORM_ORIGINATION = 'platform_origination',
  PLATFORM_SUCCESS = 'platform_success',
  INVESTOR_ENTRY = 'investor_entry',
  EARLY_EXIT = 'early_exit',
}

export enum InvestorTier {
  RETAIL = 'retail',
  VIP = 'vip',
  INSTITUTIONAL = 'institutional',
}

@Entity('fee_configurations')
@Index(['dealType', 'investorTier', 'feeType', 'effectiveFrom'], {
  name: 'IDX_fee_config_unique',
})
@Index(['dealType'], { name: 'IDX_fee_config_deal_type' })
@Index(['investorTier'], { name: 'IDX_fee_config_investor_tier' })
@Index(['feeType'], { name: 'IDX_fee_config_fee_type' })
@Index(['effectiveFrom', 'effectiveTo'], {
  name: 'IDX_fee_config_effective',
})
@Check(`rate_percent >= 0 AND rate_percent <= 100`)
export class FeeConfiguration {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique fee configuration identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @Column({ name: 'deal_type' })
  @ApiProperty({
    description: 'Deal type / commodity (e.g. "Cocoa", "Coffee")',
    example: 'Cocoa',
  })
  dealType: string;

  @Column({
    name: 'investor_tier',
    type: 'enum',
    enum: InvestorTier,
    default: InvestorTier.RETAIL,
  })
  @ApiProperty({
    description: 'Investor tier: retail, vip, or institutional',
    enum: ['retail', 'vip', 'institutional'],
    example: 'vip',
  })
  investorTier: InvestorTier;

  @Column({
    name: 'fee_type',
    type: 'enum',
    enum: FeeType,
  })
  @ApiProperty({
    description: 'Type of fee being configured',
    enum: [
      'platform_origination',
      'platform_success',
      'investor_entry',
      'early_exit',
    ],
    example: 'platform_origination',
  })
  feeType: FeeType;

  @Column({ name: 'rate_percent', type: 'numeric', precision: 5, scale: 3 })
  @ApiProperty({
    description: 'Fee rate as percentage (0-100)',
    example: 2.5,
  })
  ratePercent: number;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Human-readable description of this fee configuration',
    nullable: true,
    example: 'Platform origination fee for Cocoa deals',
  })
  description: string | null;

  @Column({ name: 'effective_from', type: 'timestamptz' })
  @ApiProperty({
    description: 'When this fee configuration becomes effective',
    example: '2024-01-01T00:00:00Z',
  })
  effectiveFrom: Date;

  @Column({
    name: 'effective_to',
    type: 'timestamptz',
    nullable: true,
  })
  @ApiProperty({
    description:
      'When this fee configuration expires (null = indefinite)',
    nullable: true,
    example: null,
  })
  effectiveTo: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({
    description: 'Configuration creation timestamp',
    example: '2024-01-01T00:00:00Z',
  })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  updatedAt: Date;
}
