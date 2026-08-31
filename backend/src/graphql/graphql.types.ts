/**
 * GraphQL ObjectType definitions (code-first approach).
 *
 * These types mirror the TypeORM entities but expose only the fields that
 * are safe to expose via the public GraphQL API. Sensitive fields such as
 * escrow secret keys, password hashes, and PII are intentionally excluded.
 */

import { ObjectType, Field, ID, Float, Int, registerEnumType } from '@nestjs/graphql';
import { TradeDealStatus, SettlementStatus } from '../trade-deals/entities/trade-deal.entity';
import { InvestmentStatus } from '../investments/entities/investment.entity';
import { MilestoneType } from '../shipments/entities/shipment-milestone.entity';
import { UserRole, KycStatus } from '../auth/entities/user.entity';

// ─── Enums ────────────────────────────────────────────────────────────────────

registerEnumType(TradeDealStatus, { name: 'TradeDealStatus' });
registerEnumType(SettlementStatus, { name: 'SettlementStatus' });
registerEnumType(InvestmentStatus, { name: 'InvestmentStatus' });
registerEnumType(MilestoneType, { name: 'MilestoneType' });

// ─── GqlUser ─────────────────────────────────────────────────────────────────

@ObjectType('User', {
  description: 'A registered platform user (farmer, trader, or investor).',
})
export class GqlUser {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  @Field()
  role: string;

  @Field()
  country: string;

  @Field()
  kycStatus: string;

  @Field({ nullable: true })
  walletAddress?: string | null;

  @Field()
  isCompany: boolean;

  @Field()
  isEmailVerified: boolean;

  @Field()
  isMfaEnabled: boolean;

  @Field({ nullable: true })
  creditScore?: number | null;

  @Field()
  preferredLanguage: string;

  @Field({ nullable: true })
  timezone?: string | null;

  @Field()
  emailDigestEnabled: boolean;

  @Field()
  createdAt: Date;
}

// ─── GqlTradeDeal ─────────────────────────────────────────────────────────────

@ObjectType('TradeDeal', {
  description: 'A trade deal for agricultural produce.',
})
export class GqlTradeDeal {
  @Field(() => ID)
  id: string;

  @Field()
  commodity: string;

  @Field({ nullable: true })
  title?: string | null;

  @Field({ nullable: true })
  description?: string | null;

  @Field(() => Float)
  quantity: number;

  @Field()
  quantityUnit: string;

  @Field(() => Float)
  totalValue: number;

  @Field(() => Float, { nullable: true })
  expectedRoi?: number | null;

  @Field(() => Int, { nullable: true })
  durationDays?: number | null;

  @Field(() => Int)
  tokenCount: number;

  @Field()
  tokenSymbol: string;

  @Field()
  status: string;

  @Field()
  farmerId: string;

  @Field(() => GqlUser, { nullable: true })
  farmer?: GqlUser | null;

  @Field()
  traderId: string;

  @Field(() => GqlUser, { nullable: true })
  trader?: GqlUser | null;

  @Field({ nullable: true })
  escrowPublicKey?: string | null;

  @Field({ nullable: true })
  issuerPublicKey?: string | null;

  @Field(() => Float)
  totalInvested: number;

  @Field()
  deliveryDate: Date;

  @Field({ nullable: true })
  riskRating?: string | null;

  @Field({ nullable: true })
  farmLocation?: string | null;

  @Field(() => Float, { nullable: true })
  farmLatitude?: number | null;

  @Field(() => Float, { nullable: true })
  farmLongitude?: number | null;

  @Field({ nullable: true })
  stellarAssetTxId?: string | null;

  @Field({ nullable: true })
  sorobanCampaignContractId?: string | null;

  @Field(() => Float, { nullable: true })
  riskScore?: number | null;

  @Field(() => Float)
  minLotSize: number;

  @Field(() => Float)
  lotStep: number;

  @Field()
  settlementStatus: string;

  @Field({ nullable: true })
  settlementTxHash?: string | null;

  @Field({ nullable: true })
  settledAt?: Date | null;

  @Field(() => [GqlInvestment], { nullable: true })
  investments?: GqlInvestment[] | null;

  @Field(() => [GqlShipmentMilestone], { nullable: true })
  milestones?: GqlShipmentMilestone[] | null;

  @Field()
  createdAt: Date;

  @Field({ nullable: true })
  deletedAt?: Date | null;
}

// ─── GqlInvestment ────────────────────────────────────────────────────────────

@ObjectType('Investment', {
  description: 'An investor\'s stake in a trade deal.',
})
export class GqlInvestment {
  @Field(() => ID)
  id: string;

  @Field()
  tradeDealId: string;

  @Field(() => GqlTradeDeal, { nullable: true })
  tradeDeal?: GqlTradeDeal | null;

  @Field()
  investorId: string;

  @Field(() => GqlUser, { nullable: true })
  investor?: GqlUser | null;

  @Field(() => Int)
  tokenAmount: number;

  @Field(() => Float)
  amountUsd: number;

  @Field({ nullable: true })
  stellarTxId?: string | null;

  @Field()
  status: string;

  @Field()
  createdAt: Date;

  @Field({ nullable: true })
  deletedAt?: Date | null;
}

// ─── GqlShipmentMilestone ─────────────────────────────────────────────────────

@ObjectType('ShipmentMilestone', {
  description: 'A recorded shipment milestone on the supply chain.',
})
export class GqlShipmentMilestone {
  @Field(() => ID)
  id: string;

  @Field()
  tradeDealId: string;

  @Field(() => GqlTradeDeal, { nullable: true })
  tradeDeal?: GqlTradeDeal | null;

  @Field()
  milestone: string;

  @Field()
  recordedBy: string;

  @Field({ nullable: true })
  notes?: string | null;

  @Field({ nullable: true })
  stellarTxId?: string | null;

  @Field({ nullable: true })
  memoText?: string | null;

  @Field(() => Float, { nullable: true })
  latitude?: number | null;

  @Field(() => Float, { nullable: true })
  longitude?: number | null;

  @Field()
  recordedAt: Date;
}

// ─── Subscription Payloads ────────────────────────────────────────────────────

@ObjectType('DealFundingUpdatedPayload', {
  description: 'Emitted when an investment is confirmed on a trade deal.',
})
export class GqlDealFundingUpdatedPayload {
  @Field(() => ID)
  dealId: string;

  @Field(() => Float)
  totalInvested: number;

  @Field(() => Float)
  totalValue: number;

  @Field(() => Float)
  fundingPercentage: number;

  @Field()
  status: string;
}

@ObjectType('PaymentDistributedPayload', {
  description: 'Emitted when escrow is released and payments are distributed.',
})
export class GqlPaymentDistributedPayload {
  @Field(() => ID)
  dealId: string;

  @Field(() => Float)
  farmerAmount: number;

  @Field(() => Float)
  platformFee: number;

  @Field(() => Float)
  totalValue: number;

  @Field()
  txHash: string;

  @Field()
  distributedAt: Date;
}

// ─── Mutation input types ─────────────────────────────────────────────────────

import { InputType } from '@nestjs/graphql';
import { IsUUID, IsInt, IsPositive, IsNumber, IsOptional, IsObject, Min } from 'class-validator';

@InputType('CreateInvestmentInput', {
  description: 'Input for creating a new investment in a trade deal.',
})
export class GqlCreateInvestmentInput {
  @Field(() => ID)
  @IsUUID()
  tradeDealId: string;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  tokenAmount: number;

  @Field(() => Float)
  @IsNumber()
  @IsPositive()
  amountUsd: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsObject()
  complianceData?: Record<string, unknown>;
}
