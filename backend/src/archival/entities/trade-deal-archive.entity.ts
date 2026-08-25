import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('trade_deals_archive')
export class TradeDealArchive {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  commodity: string;

  @Column({ type: 'decimal', precision: 36, scale: 7 })
  quantity: number;

  @Column({ name: 'quantity_unit' })
  quantityUnit: string;

  @Column({ name: 'total_value', type: 'decimal', precision: 36, scale: 7 })
  totalValue: number;

  @Column({ name: 'token_count' })
  tokenCount: number;

  @Column({ name: 'token_symbol' })
  tokenSymbol: string;

  @Column()
  status: string;

  @Column({ name: 'farmer_id' })
  farmerId: string;

  @Column({ name: 'trader_id' })
  traderId: string;

  @Column({ name: 'escrow_public_key', nullable: true })
  escrowPublicKey: string | null;

  @Column({ name: 'escrow_secret_key', nullable: true })
  escrowSecretKey: string | null;

  @Column({ name: 'issuer_public_key', nullable: true })
  issuerPublicKey: string | null;

  @Column({ name: 'issuer_secret_key', nullable: true })
  issuerSecretKey: string | null;

  @Column({ name: 'total_invested', type: 'decimal', precision: 36, scale: 7 })
  totalInvested: number;

  @Column({ name: 'delivery_date', type: 'date' })
  deliveryDate: Date;

  @Column({ name: 'stellar_asset_tx_id', nullable: true })
  stellarAssetTxId: string | null;

  @Column({ name: 'soroban_campaign_contract_id', nullable: true })
  sorobanCampaignContractId: string | null;

  @Column({ name: 'soroban_factory_tx_hash', nullable: true })
  sorobanFactoryTxHash: string | null;

  @Column({ name: 'app_trace_id', nullable: true })
  appTraceId: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', nullable: true })
  createdAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'archived_at' })
  archivedAt: Date;
}
