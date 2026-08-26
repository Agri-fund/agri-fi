import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('referral_codes')
export class ReferralCode {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Referral code ID' })
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ unique: true, length: 8 })
  @Index()
  @ApiProperty({ description: 'Unique 8-character alphanumeric referral code', example: 'ABC12345' })
  code: string;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({ description: 'Code creation timestamp' })
  createdAt: Date;
}
