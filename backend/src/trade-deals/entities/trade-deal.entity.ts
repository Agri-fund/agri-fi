import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { User } from '../../auth/entities/user.entity';
import { Document } from './document.entity';
import { Investment } from '../../investments/entities/investment.entity';

export type TradeDealStatus =
  | 'draft'
  | 'open'
  | 'funded'
  | 'delivered'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired';

@Entity('trade_deals')
export class TradeDeal {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique trade deal identifier (UUID)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @Column()
  @ApiProperty({
    description: 'Commodity name',
    example: 'Cocoa',
  })
  commodity: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Human-friendly listing title',
    example: 'Ogun State Cocoa Expansion',
    required: false,
    nullable: true,
  })
  title: string | null;

  @Column({ name: 'short_description', type: 'text', nullable: true })
  @ApiProperty({
    description: 'Short summary of the deal',
    required: false,
    nullable: true,
  })
  shortDescription: string | null;

  @Column({ name: 'long_description', type: 'text', nullable: true })
  @ApiProperty({
    description: 'Long-form story and impact description',
    required: false,
    nullable: true,
  })
  longDescription: string | null;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Country where the farm is located',
    required: false,
    nullable: true,
    example: 'Nigeria',
  })
  country: string | null;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Region or state for the farm location',
    required: false,
    nullable: true,
    example: 'Ogun',
  })
  region: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  @ApiProperty({
    description: 'Quantity of the commodity',
    example: '1000.00',
  })
  quantity: number;

  @Column({ name: 'quantity_unit', default: 'kg' })
  @ApiProperty({
    description: 'Unit of measurement',
    enum: ['kg', 'tons'],
    example: 'kg',
  })
  quantityUnit: string;

  @Column({ name: 'total_value', type: 'decimal', precision: 18, scale: 2 })
  @ApiProperty({
    description: 'Total deal value in USD',
    example: '50000.00',
  })
  totalValue: number;

  @Column({ name: 'expected_roi', type: 'decimal', precision: 6, scale: 2, nullable: true })
  @ApiProperty({
    description: 'Expected annual ROI percentage',
    required: false,
    nullable: true,
    example: 24.5,
  })
  expectedRoi: number | null;

  @Column({ name: 'duration_days', type: 'integer', nullable: true })
  @ApiProperty({
    description: 'Expected deal duration in days',
    required: false,
    nullable: true,
    example: 180,
  })
  durationDays: number | null;

  @Column({ name: 'min_investment_lot', type: 'decimal', precision: 18, scale: 2, nullable: true })
  @ApiProperty({
    description: 'Minimum investment amount',
    required: false,
    nullable: true,
    example: '250.00',
  })
  minInvestmentLot: number | null;

  @Column({ name: 'token_count' })
  @ApiProperty({
    description: 'Total tokens issued for this deal',
    example: 5000,
  })
  tokenCount: number;

  @Column({ name: 'token_symbol', unique: true })
  @ApiProperty({
    description: 'Unique token symbol for Stellar asset',
    example: 'COCOA-001',
  })
  tokenSymbol: string;

  @Column({
    type: 'text',
    default: 'draft',
  })
  @ApiProperty({
    description: 'Current deal status',
    enum: [
      'draft',
      'open',
      'funded',
      'delivered',
      'completed',
      'failed',
      'canceled',
      'expired',
    ],
    example: 'open',
  })
  status: TradeDealStatus;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'farmer_id' })
  farmer: User;

  @Column({ name: 'farmer_id' })
  @ApiProperty({
    description: 'Farmer user UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  farmerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'trader_id' })
  trader: User;

  @Column({ name: 'trader_id' })
  @ApiProperty({
    description: 'Trader user UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  traderId: string;

  @Column({ name: 'escrow_public_key', nullable: true })
  @ApiProperty({
    description: 'Stellar escrow account public key',
    nullable: true,
    example: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
  })
  escrowPublicKey: string | null;

  @Exclude()
  @Column({ name: 'escrow_secret_key', nullable: true })
  escrowSecretKey: string | null;

  @Column({ name: 'issuer_public_key', nullable: true })
  @ApiProperty({
    description: 'Stellar token issuer public key',
    nullable: true,
    example: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
  })
  issuerPublicKey: string | null;

  @Exclude()
  @Column({ name: 'issuer_secret_key', nullable: true })
  issuerSecretKey: string | null;

  @Column({
    name: 'total_invested',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  @ApiProperty({
    description: 'Total amount invested in USD',
    example: '25000.00',
  })
  totalInvested: number;

  @Column({ name: 'delivery_date', type: 'date' })
  @ApiProperty({
    description: 'Expected delivery date',
    example: '2024-06-15',
  })
  deliveryDate: Date;

  @Column({ name: 'risk_rating', nullable: true })
  @ApiProperty({
    description: 'Risk rating for the listing',
    required: false,
    nullable: true,
    enum: ['Low', 'Medium', 'High'],
  })
  riskRating: 'Low' | 'Medium' | 'High' | null;

  @Column({ name: 'farm_location', nullable: true })
  @ApiProperty({
    description: 'Textual farm location description',
    required: false,
    nullable: true,
  })
  farmLocation: string | null;

  @Column({ name: 'farm_latitude', type: 'decimal', precision: 10, scale: 6, nullable: true })
  farmLatitude: number | null;

  @Column({ name: 'farm_longitude', type: 'decimal', precision: 10, scale: 6, nullable: true })
  farmLongitude: number | null;

  @Column({ name: 'farm_photos', type: 'jsonb', default: () => "'[]'" })
  farmPhotos: Array<{
    name: string;
    size: number;
    type: string;
    previewUrl?: string | null;
  }>;

  @Column({ name: 'supporting_documents', type: 'jsonb', default: () => "'[]'" })
  supportingDocuments: Array<{
    name: string;
    type: string;
    category: string;
  }>;

  @Column({ name: 'logistics_plan', type: 'jsonb', default: () => "'[]'" })
  logisticsPlan: Array<{
    milestone: string;
    timeline: string;
    owner: string;
  }>;

  @Column({ name: 'stellar_asset_tx_id', nullable: true })
  @ApiProperty({
    description: 'Stellar transaction ID for token issuance',
    nullable: true,
    example: 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  stellarAssetTxId: string | null;

  @Column({ name: 'soroban_campaign_contract_id', nullable: true })
  @ApiProperty({
    description: 'Soroban FarmCampaign smart contract address for this deal',
    nullable: true,
    example: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  })
  sorobanCampaignContractId: string | null;

  @Column({ name: 'soroban_factory_tx_hash', nullable: true })
  @ApiProperty({
    description: 'Soroban tx hash from ProjectFactory registration',
    nullable: true,
  })
  sorobanFactoryTxHash: string | null;

  @OneToMany(() => Document, (document) => document.tradeDeal)
  documents: Document[];

  @OneToMany(() => Investment, (investment) => investment.tradeDeal)
  investments: Investment[];

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({
    description: 'Deal creation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @Column({ name: 'app_trace_id', nullable: true })
  @ApiProperty({
    description: 'Application-generated trace ID for authorized updates',
    example: 'app-1234567890abcdef',
    required: false,
    nullable: true,
  })
  appTraceId: string | null;
}
