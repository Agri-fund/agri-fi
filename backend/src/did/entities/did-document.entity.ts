import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';
import { DidDocument as DidDocumentData } from '../did.interface';

@Entity('did_document')
@Index('IDX_did_document_did', ['did'], { unique: true })
@Index('IDX_did_document_controller', ['controller'])
export class DidDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'W3C DID identifier',
    example: 'did:stellar:GA2MOCK...',
  })
  @Column({ name: 'did', type: 'varchar', length: 512 })
  did: string;

  @ApiProperty({ description: 'The persisted W3C DID document' })
  @Column({ name: 'document', type: 'jsonb' })
  document: DidDocumentData;

  @ApiProperty({ description: 'User UUID that controls this DID document' })
  @Column({ name: 'controller', type: 'uuid' })
  controller: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'controller' })
  controllerUser: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({
    name: 'deactivated_at',
    type: 'timestamptz',
    nullable: true,
  })
  deactivatedAt: Date | null;
}
