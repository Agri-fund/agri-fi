import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { SanctionsEntryType, SanctionsListSource } from '../aml.constants';

/**
 * One designated party on a sanctions / PEP list (#1217). Rows are loaded from
 * an authoritative publisher (see `SanctionsListService`) and screened by
 * normalised name, id number and, for vessels/aircraft, registration.
 */
@Entity('sanctions_list_entries')
@Index(['listSource', 'entryType'])
@Index(['normalisedName'])
@Index(['isPep', 'enabled'])
export class SanctionsListEntry {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: ['OFAC', 'UN', 'EU'] })
  @Column({ name: 'list_source', length: 16 })
  listSource: SanctionsListSource;

  @ApiProperty({
    description: 'Publisher-side identifier (SDN id, UN link id, EU reference)',
  })
  @Column({ name: 'external_id', length: 64, nullable: true, default: null })
  externalId: string | null;

  @ApiProperty({ enum: ['PERSON', 'ENTITY', 'VESSEL', 'AIRCRAFT'] })
  @Column({ name: 'entry_type', length: 16, default: 'PERSON' })
  entryType: SanctionsEntryType;

  @ApiProperty()
  @Column({ length: 255 })
  name: string;

  @ApiProperty({
    description: 'Lowercased, punctuation-stripped, whitespace-collapsed name',
  })
  @Column({ name: 'normalised_name', length: 255 })
  normalisedName: string;

  @ApiProperty({ type: 'array', items: { type: 'string' }, required: false })
  @Column({ type: 'jsonb', default: () => "'[]'" })
  aliases: string[];

  @ApiProperty({ required: false })
  @Column({ length: 16, nullable: true, default: null })
  country: string | null;

  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  @Column({ name: 'id_numbers', type: 'jsonb', default: () => "'[]'" })
  idNumbers: Array<{ type: string; value: string; normalised: string }>;

  @ApiProperty({ required: false })
  @Column({ name: 'date_of_birth', length: 32, nullable: true, default: null })
  dateOfBirth: string | null;

  @ApiProperty({
    description: 'Politically exposed person flag for PEP screening',
  })
  @Column({ name: 'is_pep', type: 'boolean', default: false })
  isPep: boolean;

  @ApiProperty({ required: false })
  @Column({ name: 'pep_role', length: 160, nullable: true, default: null })
  pepRole: string | null;

  @ApiProperty({ description: 'Sanctions programme, list tag or reason' })
  @Column({ length: 120, default: '' })
  programme: string;

  @ApiProperty()
  @Column({ length: 64, default: '' })
  remarks: string;

  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @ApiProperty({
    description: 'Publication date/version carried from the source list',
  })
  @Column({ name: 'list_version', length: 64, nullable: true, default: null })
  listVersion: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
