/**
 * TradeDeal DataLoader.
 *
 * Batches deal lookups to prevent N+1 queries when resolving the `tradeDeal`
 * field on Investment or ShipmentMilestone objects.
 *
 * A fresh instance is created per request inside GraphQLModule's `context`
 * factory so cached results never escape their request boundary.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import DataLoader from 'dataloader';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { GqlTradeDeal } from '../graphql.types';

export type DealDataLoaderType = DataLoader<string, GqlTradeDeal | null>;

/** Map a TradeDeal entity to a GqlTradeDeal, omitting secret keys. */
function toGqlDeal(deal: TradeDeal): GqlTradeDeal {
  return {
    id: deal.id,
    commodity: deal.commodity,
    title: deal.title,
    description: deal.description,
    quantity: Number(deal.quantity),
    quantityUnit: deal.quantityUnit,
    totalValue: Number(deal.totalValue),
    expectedRoi: deal.expectedRoi != null ? Number(deal.expectedRoi) : null,
    durationDays: deal.durationDays,
    tokenCount: deal.tokenCount,
    tokenSymbol: deal.tokenSymbol,
    status: deal.status,
    farmerId: deal.farmerId,
    traderId: deal.traderId,
    escrowPublicKey: deal.escrowPublicKey,
    issuerPublicKey: deal.issuerPublicKey,
    totalInvested: Number(deal.totalInvested),
    deliveryDate: deal.deliveryDate,
    riskRating: deal.riskRating,
    farmLocation: deal.farmLocation,
    farmLatitude: deal.farmLatitude != null ? Number(deal.farmLatitude) : null,
    farmLongitude: deal.farmLongitude != null ? Number(deal.farmLongitude) : null,
    stellarAssetTxId: deal.stellarAssetTxId,
    sorobanCampaignContractId: deal.sorobanCampaignContractId,
    riskScore: deal.riskScore != null ? Number(deal.riskScore) : null,
    minLotSize: Number(deal.minLotSize),
    lotStep: Number(deal.lotStep),
    settlementStatus: deal.settlementStatus,
    settlementTxHash: deal.settlementTxHash,
    settledAt: deal.settledAt,
    createdAt: deal.createdAt,
    deletedAt: deal.deletedAt,
  };
}

@Injectable()
export class DealDataLoaderService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
  ) {}

  /**
   * Create a new DataLoader instance for a single request scope.
   */
  createLoader(): DealDataLoaderType {
    return new DataLoader<string, GqlTradeDeal | null>(
      async (ids: readonly string[]) => {
        const deals = await this.dealRepo.find({
          where: { id: In([...ids]) },
        });

        const dealMap = new Map<string, GqlTradeDeal>(
          deals.map((d) => [d.id, toGqlDeal(d)]),
        );

        // Return results in input order — DataLoader requirement.
        return ids.map((id) => dealMap.get(id) ?? null);
      },
      { cache: true },
    );
  }
}
