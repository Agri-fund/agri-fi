import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('accreditation_review_queue')
export class AccreditationReview {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier (UUID)' })
  id: string;

  @Column({ name: 'user_id' })
  @ApiProperty({ description: 'User UUID who submitted the declaration' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'tier_requested', type: 'text' })
  @ApiProperty({
    description: 'Tier level requested by the user',
    enum: ['accredited', 'institutional'],
    example: 'accredited',
  })
  tierRequested: string;

  @Column({ name: 'document_url', type: 'text', nullable: true })
  @ApiProperty({
    description: 'URL of supporting document provided during declaration',
    nullable: true,
    example: 'https://ipfs.io/ipfs/QmXxxx',
  })
  documentUrl: string | null;

  @Column({ type: 'text', default: 'pending' })
  @ApiProperty({
    description: 'Review status',
    enum: ['pending', 'approved', 'rejected'],
    example: 'pending',
  })
  status: string;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  @ApiProperty({
    description: 'Admin user UUID who reviewed the submission',
    nullable: true,
  })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'Timestamp when the review was completed', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @ApiProperty({ description: 'Submission timestamp' })
  createdAt: Date;
}
