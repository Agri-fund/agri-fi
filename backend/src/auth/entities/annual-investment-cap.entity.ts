import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('annual_investment_caps')
export class AnnualInvestmentCap {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier (UUID)' })
  id: string;

  @Column({ name: 'user_id' })
  @ApiProperty({ description: 'Investor user UUID' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'int' })
  @ApiProperty({ description: 'Calendar year', example: 2026 })
  year: number;

  @Column({
    name: 'total_invested',
    type: 'decimal',
    precision: 36,
    scale: 7,
    default: 0,
  })
  @ApiProperty({
    description: 'Total USD invested in the given calendar year',
    example: '1500.00',
  })
  totalInvested: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}
