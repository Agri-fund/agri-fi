import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type AdminActionType =
  | 'approve_kyc'
  | 'approve_corporate_kyc'
  | 'update_user_role'
  | 'freeze_asset'
  | 'verify_document'
  | 'reject_document';

@Entity('admin_actions')
export class AdminAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'admin_id' })
  adminId: string;

  @Column({ name: 'target_user_id', nullable: true })
  targetUserId: string | null;

  @Column({ length: 50 })
  action: AdminActionType;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
