import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import {
  AmlScreeningDecision,
  AmlScreeningSubjectType,
  SanctionsListSource,
} from '../aml.constants';

/**
 * Immutable outcome of one screening pass (#1217). Every user, wallet and money
 * movement that goes through monitoring leaves a row here, which is what makes
 * an examiner's "when was this screened, against which list version" question
 * answerable.
 */
@Entity('aml_screening_results')
@Index(['subjectType', 'subjectId'])
@Index(['decision', 'createdAt'])
export class AmlScreeningResult {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: ['user', 'wallet', 'transaction'] })
  @Column({ name: 'subject_type', length: 24 })
  subjectType: AmlScreeningSubjectType;

  @ApiProperty()
  @Column({ name: 'subject_id', length: 64 })
  subjectId: string;

  @ApiProperty({ description: 'Name or address that was actually screened' })
  @Column({ name: 'subject_label', length: 255, default: '' })
  subjectLabel: string;

  @ApiProperty({ enum: ['OFAC', 'UN', 'EU', 'PEP', 'KYT', 'INTERNAL'] })
  @Column({ name: 'list_source', length: 16 })
  listSource: SanctionsListSource | 'PEP' | 'KYT' | 'INTERNAL';

  @ApiProperty({ enum: ['clear', 'review', 'match'] })
  @Column({ length: 16 })
  decision: AmlScreeningDecision;

  @ApiProperty({ description: '0-100 similarity or provider risk score' })
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  score: number;

  @ApiProperty({ required: false })
  @Column({
    name: 'matched_entry_id',
    type: 'uuid',
    nullable: true,
    default: null,
  })
  matchedEntryId: string | null;

  @ApiProperty({ required: false })
  @Column({ name: 'matched_name', length: 255, nullable: true, default: null })
  matchedName: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  details: Record<string, unknown>;

  @ApiProperty()
  @Column({ name: 'screened_by', type: 'uuid', nullable: true, default: null })
  screenedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
