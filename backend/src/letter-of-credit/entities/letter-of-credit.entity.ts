import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { LetterOfCredit } from '../letter-of-credit.types';

/**
 * Persistent store for Letters of Credit. The full LC document is kept in a
 * jsonb column; frequently queried fields are duplicated as indexed columns.
 */
@Entity('letter_of_credit')
export class LetterOfCreditEntity {
  @PrimaryColumn('varchar')
  id: string;

  @Index()
  @Column({ name: 'deal_id', type: 'varchar' })
  dealId: string;

  @Index()
  @Column({ type: 'varchar' })
  status: string;

  @Column({ type: 'jsonb' })
  data: LetterOfCredit;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
