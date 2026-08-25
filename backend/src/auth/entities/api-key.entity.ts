import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';

export type ApiKeyScope = 'read:deals' | 'write:investments' | 'read:reports' | 'webhook:manage';

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'API Key unique identifier (UUID)' })
  id: string;

  @Exclude()
  @Column({ name: 'hashed_key', length: 64 })
  @Index({ unique: true })
  hashedKey: string;

  @Column({ length: 16 })
  @ApiProperty({ description: 'Key prefix for identification / masking', example: 'agfi_live_3f9a' })
  prefix: string;

  @Column({ length: 100 })
  @ApiProperty({ description: 'Human-readable label / description for key', example: 'Oracle Integration Key' })
  label: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  @ApiProperty({ description: 'Owner User UUID' })
  ownerId: string;

  @Column({ type: 'simple-array' })
  @ApiProperty({
    description: 'Granted API permission scopes',
    example: ['read:deals', 'write:investments'],
  })
  scopes: ApiKeyScope[];

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'Timestamp when the key was last used', nullable: true })
  lastUsedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'Optional expiration timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'Revocation timestamp if revoked', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
