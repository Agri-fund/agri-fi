import {
  Injectable,
  Optional,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, QueryRunner } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { TradeDeal, TradeDealStatus } from './entities/trade-deal.entity';
import { Document, DocumentType } from './entities/document.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { CreateTradeDealDto } from './dto/create-trade-deal.dto';
import { User } from '../auth/entities/user.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';
import { RiskScoringService } from './risk-scoring.service';
import { SorobanService } from '../soroban/soroban.service';

const VALID_DOC_TYPES: DocumentType[] = [
  'purchase_agreement',
  'bill_of_lading',
  'export_certificate',
  'warehouse_receipt',
];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const PUBLIC_STATUSES: TradeDealStatus[] = ['open', 'funded'];

type DealSearchSortBy =
  'newest' | 'highest_roi' | 'closing_soon' | 'most_funded';
type DealDurationBucket =
  '<3 months' | '3-6 months' | '6-12 months' | '>12 months';

export interface TradeDealSearchQuery {
  commodity?: string;
  country?: string;
  minAmount?: number;
  maxAmount?: number;
  minRoi?: number;
  maxRoi?: number;
  duration?: DealDurationBucket;
  riskRating?: 'Low' | 'Medium' | 'High';
  status?: 'open' | 'almost funded' | 'fully funded';
  sortBy?: DealSearchSortBy;
  page?: number;
  limit?: number;
  q?: string;
}

function bucketToDayRange(
  bucket?: DealDurationBucket,
): [number, number] | null {
  if (!bucket) return null;
  if (bucket === '<3 months') return [0, 90];
  if (bucket === '3-6 months') return [91, 180];
  if (bucket === '6-12 months') return [181, 365];
  return [366, Number.MAX_SAFE_INTEGER];
}

export interface AddDocumentDto {
  tradeDealId: string;
  uploaderId: string;
  docType: string;
  ipfsHash: string;
  storageUrl: string;
  stellarTxId?: string | null;
  fileSizeBytes?: number;
  memoText?: string | null;
  signatureVerified?: boolean;
}

@Injectable()
export class TradeDealsService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    private readonly stellarService: StellarService,
    private readonly queueService: QueueService,
    private readonly riskScoringService: RiskScoringService,
    @Optional() private readonly sorobanService?: SorobanService,
    private readonly logger: PinoLogger,
    private readonly dataSource: DataSource,
  ) {
    this.logger.setContext(TradeDealsService.name);
  }

  async updateDealStatus(
    dealId: string,
    status: TradeDealStatus,
    stellarAssetTxId?: string,
  ): Promise<void> {
    // Generate an application trace ID for authorized updates
    const appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
    await this.tradeDealRepo.update(dealId, {
      status,
      appTraceId,
      ...(stellarAssetTxId && { stellarAssetTxId }),
    });
  }

  async createDeal(
    traderId: string,
    dto: CreateTradeDealDto,
  ): Promise<TradeDeal> {
    const normalizedTitle = dto.title?.trim() || dto.commodity.trim();
    const existingTitle = await this.tradeDealRepo
      .createQueryBuilder('deal')
      .where('LOWER(deal.title) = LOWER(:title)', { title: normalizedTitle })
      .getOne();
    if (existingTitle) {
      throw new BadRequestException({
        code: 'DUPLICATE_TITLE',
        message: 'A deal with this title already exists.',
      });
    }

    const farmerId = dto.farmer_id ?? traderId;
    const effectiveTraderId = dto.trader_id ?? traderId;

    const farmer = await this.userRepo.findOne({ where: { id: farmerId } });
    if (!farmer) throw new NotFoundException('Farmer not found.');
    if (farmer.role !== 'farmer') {
      throw new BadRequestException({
        code: 'INVALID_FARMER',
        message: 'farmer_id must belong to a user with role "farmer".',
      });
    }

    const tokenCount = Math.floor(Number(dto.total_value) / 100);

    if (tokenCount < 1) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN_COUNT',
        message:
          'total_value must be at least 100 USD to create at least one token.',
      });
    }

    const tradeDeal = this.tradeDealRepo.create({
      title: normalizedTitle,
      commodity: dto.commodity,
      country: dto.country ?? 'Unknown',
      region: dto.region ?? null,
      shortDescription: dto.short_description ?? null,
      longDescription: dto.long_description ?? null,
      quantity: dto.quantity,
      quantityUnit: dto.quantity_unit,
      totalValue: dto.total_value,
      expectedRoi: dto.expected_roi ?? null,
      durationDays: dto.duration_days ?? null,
      minInvestmentLot: dto.min_investment_lot ?? null,
      riskRating: dto.risk_rating ?? null,
      farmLocation: dto.farm_location ?? null,
      farmLatitude: dto.farm_latitude ?? null,
      farmLongitude: dto.farm_longitude ?? null,
      farmPhotos: dto.farm_photos ?? [],
      supportingDocuments: dto.supporting_documents ?? [],
      logisticsPlan: dto.logistics_plan ?? [],
      tokenCount,
      tokenSymbol: 'PENDING',
      status: 'draft',
      farmerId,
      traderId: effectiveTraderId,
      totalInvested: 0,
      deliveryDate: new Date(dto.delivery_date),
      fundingDeadline: new Date(dto.funding_deadline ?? dto.delivery_date),
      minimumFundingTarget: dto.minimum_funding_target ?? dto.total_value,
      minLotSize: dto.min_lot_size ?? 1,
      lotStep: dto.lot_step ?? 1,
      escrowPublicKey: null,
      escrowSecretKey: null,
      issuerPublicKey: null,
      issuerSecretKey: null,
      stellarAssetTxId: null,
    } as any);

    const savedDeal = await this.tradeDealRepo.save(tradeDeal);

    savedDeal.tokenSymbol = this.generateTokenSymbol(
      savedDeal.commodity,
      savedDeal.id,
    );

    const saved = await this.tradeDealRepo.save(savedDeal);

    // #828 — compute initial risk score (non-blocking)
    this.riskScoringService.computeAndPersist(saved.id).catch((err) => {
      this.logger.warn(
        { dealId: saved.id, error: err.message },
        'Failed to compute initial risk score',
      );
    });

    return saved;
  }

  async findOpen(query: {
    commodity?: string;
    country?: string;
    region?: string;
    minAmount?: number;
    maxAmount?: number;
    minRoi?: number;
    maxRoi?: number;
    duration?: DealDurationBucket;
    riskRating?: 'Low' | 'Medium' | 'High';
    status?: 'open' | 'almost funded' | 'fully funded';
    sortBy?: DealSearchSortBy;
    q?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const skip = (page - 1) * limit;

    if (query.commodity && !/^[a-zA-Z0-9 _,-]{1,100}$/.test(query.commodity)) {
      throw new BadRequestException('Invalid commodity search term.');
    }

    const qb = this.tradeDealRepo
      .createQueryBuilder('deal')
      .where('deal.status IN (:...statuses)', { statuses: PUBLIC_STATUSES })
      .select([
        'deal.id',
        'deal.title',
        'deal.commodity',
        'deal.country',
        'deal.region',
        'deal.quantity',
        'deal.quantityUnit',
        'deal.totalValue',
        'deal.totalInvested',
        'deal.tokenCount',
        'deal.tokenSymbol',
        'deal.deliveryDate',
        'deal.shortDescription',
        'deal.longDescription',
        'deal.expectedRoi',
        'deal.durationDays',
        'deal.minInvestmentLot',
        'deal.riskRating',
        'deal.farmLocation',
        'deal.farmerId',
        'deal.traderId',
        'deal.riskScore',
        'deal.riskRating',
      ])
      .skip(skip)
      .take(limit);

    const commodityValues = query.commodity
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (commodityValues && commodityValues.length > 0) {
      qb.andWhere('LOWER(deal.commodity) IN (:...commodityValues)', {
        commodityValues: commodityValues.map((value) => value.toLowerCase()),
      });
    }

    if (query.country) {
      qb.andWhere("LOWER(COALESCE(deal.country, '')) LIKE LOWER(:country)", {
        country: `%${query.country}%`,
      });
    }

    if (query.region) {
      qb.andWhere("LOWER(COALESCE(deal.region, '')) LIKE LOWER(:region)", {
        region: `%${query.region}%`,
      });
    }

    if (
      typeof query.minAmount === 'number' &&
      Number.isFinite(query.minAmount)
    ) {
      qb.andWhere('COALESCE(deal.min_investment_lot, 0) >= :minAmount', {
        minAmount: query.minAmount,
      });
    }

    if (
      typeof query.maxAmount === 'number' &&
      Number.isFinite(query.maxAmount)
    ) {
      qb.andWhere('COALESCE(deal.min_investment_lot, 0) <= :maxAmount', {
        maxAmount: query.maxAmount,
      });
    }

    if (typeof query.minRoi === 'number' && Number.isFinite(query.minRoi)) {
      qb.andWhere('COALESCE(deal.expected_roi, 0) >= :minRoi', {
        minRoi: query.minRoi,
      });
    }

    if (typeof query.maxRoi === 'number' && Number.isFinite(query.maxRoi)) {
      qb.andWhere('COALESCE(deal.expected_roi, 0) <= :maxRoi', {
        maxRoi: query.maxRoi,
      });
    }

    const durationRange = bucketToDayRange(query.duration);
    if (durationRange) {
      qb.andWhere(
        'COALESCE(deal.duration_days, 0) BETWEEN :minDuration AND :maxDuration',
        {
          minDuration: durationRange[0],
          maxDuration: durationRange[1],
        },
      );
    }

    if (query.riskRating) {
      qb.andWhere('deal.risk_rating = :riskRating', {
        riskRating: query.riskRating,
      });
    }

    if (query.status) {
      if (query.status === 'open') {
        qb.andWhere('deal.total_invested < deal.total_value * 0.5');
      } else if (query.status === 'almost funded') {
        qb.andWhere(
          'deal.total_invested >= deal.total_value * 0.5 AND deal.total_invested < deal.total_value',
        );
      } else if (query.status === 'fully funded') {
        qb.andWhere('deal.total_invested >= deal.total_value');
      }
    }

    if (query.q?.trim()) {
      qb.andWhere(
        `to_tsvector('english', coalesce(deal.title, '') || ' ' || coalesce(deal.short_description, '') || ' ' || coalesce(deal.long_description, '')) @@ plainto_tsquery('english', :search)`,
        { search: query.q.trim() },
      );
    }

    switch (query.sortBy) {
      case 'highest_roi':
        qb.orderBy('COALESCE(deal.expected_roi, 0)', 'DESC').addOrderBy(
          'deal.created_at',
          'DESC',
        );
        break;
      case 'closing_soon':
        qb.orderBy('deal.delivery_date', 'ASC');
        break;
      case 'most_funded':
        qb.orderBy('deal.total_invested', 'DESC').addOrderBy(
          'deal.created_at',
          'DESC',
        );
        break;
      case 'newest':
      default:
        qb.orderBy('deal.created_at', 'DESC');
        break;
    }

    const [deals, total] = await qb.getManyAndCount();

    return {
      data: deals.map((deal) => ({
        id: deal.id,
        title: deal.title,
        commodity: deal.commodity,
        country: deal.country,
        region: deal.region,
        quantity: deal.quantity,
        quantity_unit: deal.quantityUnit,
        total_value: deal.totalValue,
        total_invested: deal.totalInvested,
        funded_amount: deal.totalInvested,
        token_count: deal.tokenCount,
        token_symbol: deal.tokenSymbol,
        delivery_date: deal.deliveryDate,
        short_description: deal.shortDescription,
        long_description: deal.longDescription,
        expected_roi: deal.expectedRoi,
        duration_days: deal.durationDays,
        min_investment_lot: deal.minInvestmentLot,
        risk_rating: deal.riskRating,
        farm_location: deal.farmLocation,
        farmer_id: deal.farmerId,
        trader_id: deal.traderId,
        remaining_funding: Number(deal.totalValue) - Number(deal.totalInvested),
        risk_score: deal.riskScore,
        risk_rating: deal.riskRating,
        min_lot_size: Number(deal.minLotSize),
        lot_step: Number(deal.lotStep),
      })),
      total,
      page,
      limit,
    };
  }

  async findOne(
    id: string,
    access?: { canViewSensitive?: boolean },
  ): Promise<any> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id },
      relations: ['farmer', 'trader', 'documents', 'investments'],
    });

    if (!deal) {
      throw new NotFoundException('Trade deal not found');
    }

    const milestones = await this.milestoneRepo.find({
      where: { tradeDealId: id },
      order: { recordedAt: 'ASC' },
    });

    const confirmedInvestments =
      deal.investments?.filter((inv) => inv.status === 'confirmed') || [];
    const tokensSold = confirmedInvestments.reduce(
      (sum, inv) => sum + Number(inv.tokenAmount),
      0,
    );
    const tokensRemaining = Number(deal.tokenCount) - tokensSold;

    const canViewSensitive = !!access?.canViewSensitive;
    const publicDetail = {
      id: deal.id,
      title: deal.title,
      commodity: deal.commodity,
      country: deal.country,
      region: deal.region,
      quantity: deal.quantity,
      quantity_unit: deal.quantityUnit,
      total_value: deal.totalValue,
      delivery_date: deal.deliveryDate,
      status: deal.status,
      short_description: deal.shortDescription,
      long_description: deal.longDescription,
      token_count: deal.tokenCount,
      token_symbol: deal.tokenSymbol,
      total_invested: deal.totalInvested,
      funded_amount: deal.totalInvested,
      expected_roi: deal.expectedRoi,
      duration_days: deal.durationDays,
      min_investment_lot: deal.minInvestmentLot,
      risk_rating: deal.riskRating,
      farm_location: deal.farmLocation,
      farm_photos: deal.farmPhotos,
      logistics_plan: deal.logisticsPlan,
      tokens_remaining: tokensRemaining,
      trader_name: deal.trader?.email || 'Unknown Trader',
      description: `${deal.quantity} ${deal.quantityUnit} of ${deal.commodity} for delivery by ${new Date(
        deal.deliveryDate,
      ).toLocaleDateString()}`,
      risk_score: deal.riskScore,
      risk_rating: deal.riskRating,
      risk_breakdown: deal.riskBreakdown,
      // #835 — lot sizing exposed to the investment form
      min_lot_size: Number(deal.minLotSize),
      lot_step: Number(deal.lotStep),
      // #830 — on-chain FarmCampaign contract address for this deal
      soroban_contract_address: deal.sorobanCampaignContractId ?? null,
    };

    if (!canViewSensitive) {
      return publicDetail;
    }

    return {
      ...publicDetail,
      farmer_id: deal.farmerId,
      trader_id: deal.traderId,
      escrow_public_key: deal.escrowPublicKey,
      issuer_public_key: deal.issuerPublicKey,
      documents: deal.documents ?? [],
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        milestone: milestone.milestone,
        notes: milestone.notes,
        stellar_tx_id: milestone.stellarTxId,
        recorded_by: milestone.recordedBy,
        recorded_at: milestone.recordedAt,
      })),
    };
  }

  async publishDeal(dealId: string, traderId: string): Promise<TradeDeal> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['documents'],
    });

    if (!deal) {
      throw new NotFoundException('Trade deal not found.');
    }

    if (deal.traderId !== traderId) {
      throw new ForbiddenException({
        code: 'NOT_ASSIGNED_TRADER',
        message: 'Only the assigned trader can publish this deal.',
      });
    }

    if (deal.status !== 'draft') {
      throw new UnprocessableEntityException({
        code: 'DEAL_NOT_DRAFT',
        message: 'Only draft deals can be published.',
      });
    }

    if (!deal.documents || deal.documents.length === 0) {
      throw new UnprocessableEntityException({
        code: 'NO_DOCUMENTS',
        message: 'At least one document must be uploaded before publishing.',
      });
    }

    try {
      // Create escrow account synchronously (fast operation)
      this.logger.info({ dealId }, 'Creating escrow account for deal');
      const { publicKey: escrowPublicKey, secretKey: escrowSecretKey } =
        await this.stellarService.createEscrowAccount(dealId);

      // Encrypt the escrow secret
      const encryptedEscrowSecret =
        await this.stellarService.encryptSecret(escrowSecretKey);

      // Update deal with escrow data and enqueue token issuance atomically:
      // if enqueueing fails, the escrow-key write must roll back too, since
      // the deal would otherwise be stuck holding an escrow account no job
      // will ever process.
      // Use transactional outbox for atomic DB update + event publish
      return await this.dataSource.transaction(async (entityManager) => {
        await entityManager.update(TradeDeal, dealId, {
          escrowPublicKey,
          escrowSecretKey: encryptedEscrowSecret,
        });

        this.logger.info(
          { dealId, escrowPublicKey },
          'Escrow account created, enqueuing token issuance',
        );

        await this.queueService.enqueueDealPublishTransactional(entityManager, {
          dealId,
          tokenSymbol: deal.tokenSymbol,
          escrowPublicKey,
          encryptedEscrowSecret,
          tokenCount: deal.tokenCount,
        });

        // Return deal with escrow data (status still draft, will be updated by queue processor)
        return {
          ...deal,
          escrowPublicKey,
          escrowSecretKey: encryptedEscrowSecret,
        };
      });
    } catch (error) {
      this.logger.error(
        { dealId, error: error.message },
        'Failed to publish deal - escrow account creation failed',
      );

      // Deal remains in draft status on Stellar failure
      throw new UnprocessableEntityException({
        code: 'STELLAR_OPERATION_FAILED',
        message: 'Failed to create escrow account. Please try again.',
      });
    }
  }

  async addDocument(dto: AddDocumentDto): Promise<Document> {
    if (!VALID_DOC_TYPES.includes(dto.docType as DocumentType)) {
      throw new BadRequestException({
        code: 'INVALID_DOC_TYPE',
        message: `Invalid document type. Must be one of: ${VALID_DOC_TYPES.join(', ')}.`,
      });
    }

    if (
      dto.fileSizeBytes !== undefined &&
      dto.fileSizeBytes > MAX_FILE_SIZE_BYTES
    ) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `File size exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
      });
    }

    const deal = await this.tradeDealRepo.findOne({
      where: { id: dto.tradeDealId },
    });
    if (!deal) {
      throw new NotFoundException('Trade deal not found.');
    }

    const doc = this.documentRepo.create({
      tradeDealId: dto.tradeDealId,
      uploaderId: dto.uploaderId,
      docType: dto.docType as DocumentType,
      ipfsHash: dto.ipfsHash,
      storageUrl: dto.storageUrl,
      stellarTxId: dto.stellarTxId ?? null,
      memoText: dto.memoText ?? null,
      signatureVerified: dto.signatureVerified ?? false,
    });

    return this.documentRepo.save(doc);
  }

  async cancelDeal(dealId: string, traderId: string): Promise<TradeDeal> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['investments', 'investments.investor'],
    });

    if (!deal) {
      throw new NotFoundException('Trade deal not found.');
    }

    if (deal.traderId !== traderId) {
      throw new ForbiddenException({
        code: 'NOT_ASSIGNED_TRADER',
        message: 'Only the assigned trader can cancel this deal.',
      });
    }

    if (deal.status === 'canceled') {
      return deal;
    }

    const cancellableStatuses: TradeDealStatus[] = ['draft', 'open'];
    if (!cancellableStatuses.includes(deal.status)) {
      throw new UnprocessableEntityException({
        code: 'DEAL_NOT_CANCELABLE',
        message: `Cannot cancel a deal in "${deal.status}" status. Only draft or open deals can be canceled.`,
      });
    }

    const confirmedInvestments =
      deal.investments?.filter(
        (inv) => inv.status === InvestmentStatus.CONFIRMED,
      ) || [];

    if (
      deal.status === 'open' &&
      deal.issuerPublicKey &&
      deal.issuerSecretKey &&
      deal.stellarAssetTxId
    ) {
      const investorShares: { walletAddress: string; tokenAmount: number }[] =
        confirmedInvestments
          .filter((inv) => inv.investor?.walletAddress)
          .map((inv) => ({
            walletAddress: inv.investor.walletAddress as string,
            tokenAmount: Number(inv.tokenAmount),
          }));

      const tokensSold = investorShares.reduce(
        (acc, curr) => acc + curr.tokenAmount,
        0,
      );
      const unsoldTokens = Number(deal.tokenCount) - tokensSold;

      if (unsoldTokens > 0 && deal.escrowPublicKey) {
        investorShares.push({
          walletAddress: deal.escrowPublicKey,
          tokenAmount: unsoldTokens,
        });
      }

      if (investorShares.length > 0) {
        const issuerSecret = await this.stellarService.decryptSecret(
          deal.issuerSecretKey,
        );

        this.logger.info(
          {
            dealId,
            tokenCount: deal.tokenCount,
            holders: investorShares.length,
          },
          'Initiating clawback for canceled deal',
        );

        await this.stellarService.clawbackTokens(
          deal.tokenSymbol,
          deal.issuerPublicKey,
          issuerSecret,
          investorShares,
        );
      }
    }

    deal.status = 'canceled';
    // Set appTraceId for this authorized update
    deal.appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;

    // Refunding investments and updating deal status must succeed or fail
    // together, since the Stellar clawback above has already moved funds and
    // a partial DB write here would leave local state inconsistent with it.
    return this.dataSource.transaction(async (manager) => {
      if (confirmedInvestments.length > 0) {
        await manager.update(
          Investment,
          confirmedInvestments.map((inv) => inv.id),
          { status: InvestmentStatus.REFUNDED },
        );
        this.logger.info(
          { dealId, refundedCount: confirmedInvestments.length },
          'Refunded confirmed investments for canceled deal',
        );
      }

      return manager.save(deal);
    });
  }

  async expireDeal(dealId: string): Promise<TradeDeal> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['investments', 'investments.investor'],
    });

    if (!deal) {
      throw new NotFoundException('Trade deal not found.');
    }

    if (deal.status !== 'open') {
      throw new UnprocessableEntityException({
        code: 'DEAL_NOT_OPEN',
        message: `Cannot expire a deal in "${deal.status}" status. Only open deals can be expired.`,
      });
    }

    if (Number(deal.totalInvested) >= Number(deal.totalValue)) {
      throw new UnprocessableEntityException({
        code: 'DEAL_FUNDED',
        message: 'Cannot expire a deal that has already reached its funding target.',
      });
    }

    const confirmedInvestments =
      deal.investments?.filter(
        (inv) => inv.status === InvestmentStatus.CONFIRMED,
      ) || [];

    if (deal.issuerPublicKey && deal.issuerSecretKey && deal.stellarAssetTxId) {
      const investorShares: { walletAddress: string; tokenAmount: number }[] =
        confirmedInvestments
          .filter((inv) => inv.investor?.walletAddress)
          .map((inv) => ({
            walletAddress: inv.investor.walletAddress as string,
            tokenAmount: Number(inv.tokenAmount),
          }));

      const tokensSold = investorShares.reduce(
        (acc, curr) => acc + curr.tokenAmount,
        0,
      );
      const unsoldTokens = Number(deal.tokenCount) - tokensSold;

      if (unsoldTokens > 0 && deal.escrowPublicKey) {
        investorShares.push({
          walletAddress: deal.escrowPublicKey,
          tokenAmount: unsoldTokens,
        });
      }

      if (investorShares.length > 0) {
        const issuerSecret = await this.stellarService.decryptSecret(
          deal.issuerSecretKey,
        );

        this.logger.info(
          {
            dealId,
            tokenCount: deal.tokenCount,
            holders: investorShares.length,
          },
          'Initiating clawback for expired deal',
        );

        await this.stellarService.clawbackTokens(
          deal.tokenSymbol,
          deal.issuerPublicKey,
          issuerSecret,
          investorShares,
        );
      }
    }

    if (confirmedInvestments.length > 0) {
      await this.investmentRepo.update(
        confirmedInvestments.map((inv) => inv.id),
        { status: InvestmentStatus.REFUNDED },
      );
      this.logger.info(
        { dealId, refundedCount: confirmedInvestments.length },
        'Refunded confirmed investments for expired deal',
      );
    }

    deal.status = 'expired';
    deal.appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;

    const saved = await this.tradeDealRepo.save(deal);

    this.queueService.emit('email.notification', {
      type: 'deal_expired',
      dealId,
      commodity: deal.commodity,
      traderId: deal.traderId,
      farmerId: deal.farmerId,
    });

    this.queueService.emit('admin.alert', {
      type: 'deal_expired',
      dealId,
      commodity: deal.commodity,
      timestamp: new Date().toISOString(),
    });

    return saved;
  }

  async closeUnderfundedDeal(dealId: string): Promise<TradeDeal> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['investments', 'investments.investor'],
    });

    if (!deal) throw new NotFoundException('Trade deal not found.');
    if (deal.status !== 'open') {
      throw new UnprocessableEntityException({
        code: 'DEAL_NOT_OPEN',
        message: `Cannot close a deal in "${deal.status}" status.`,
      });
    }

    const minimumTarget = Number(deal.minimumFundingTarget ?? deal.totalValue);
    if (Number(deal.totalInvested) >= minimumTarget) {
      throw new UnprocessableEntityException({
        code: 'FUNDING_TARGET_REACHED',
        message: 'Cannot close a deal that reached its minimum funding target.',
      });
    }

    const confirmedInvestments = (deal.investments ?? []).filter(
      (investment) => investment.status === InvestmentStatus.CONFIRMED,
    );

    if (deal.sorobanCampaignContractId && this.sorobanService) {
      await this.sorobanService.markCampaignFailed(
        deal.sorobanCampaignContractId,
      );
      for (const investment of confirmedInvestments) {
        const walletAddress = investment.investor?.walletAddress;
        if (!walletAddress) {
          throw new UnprocessableEntityException({
            code: 'INVESTOR_WALLET_REQUIRED',
            message: `Investment ${investment.id} has no wallet address for refund.`,
          });
        }
        await this.sorobanService.refundCampaignInvestor(
          deal.sorobanCampaignContractId,
          walletAddress,
        );
      }
    } else {
      await this.refundConfirmedInvestmentsWithClawback(deal, confirmedInvestments);
    }

    if (confirmedInvestments.length > 0) {
      await this.investmentRepo.update(
        confirmedInvestments.map((investment) => investment.id),
        { status: InvestmentStatus.REFUNDED },
      );
    }
    deal.status = 'expired';
    deal.appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
    return this.tradeDealRepo.save(deal);
  }

  private async refundConfirmedInvestmentsWithClawback(
    deal: TradeDeal,
    confirmedInvestments: Investment[],
  ): Promise<void> {
    if (!deal.issuerPublicKey || !deal.issuerSecretKey || !deal.stellarAssetTxId) return;
    const shares = confirmedInvestments
      .filter((investment) => investment.investor?.walletAddress)
      .map((investment) => ({
        walletAddress: investment.investor!.walletAddress as string,
        tokenAmount: Number(investment.tokenAmount),
      }));
    if (shares.length === 0) return;
    const issuerSecret = await this.stellarService.decryptSecret(deal.issuerSecretKey);
    await this.stellarService.clawbackTokens(
      deal.tokenSymbol,
      deal.issuerPublicKey,
      issuerSecret,
      shares,
    );
  }

  async findByUser(userId: string, role: string): Promise<any[]> {
    if (role !== 'farmer' && role !== 'trader') {
      return [];
    }

    const whereCondition =
      role === 'farmer' ? { farmerId: userId } : { traderId: userId };

    const deals = await this.tradeDealRepo.find({
      where: whereCondition,
      relations: ['farmer', 'trader', 'milestones'],
    });

    // Get document count for each deal
    const dealsWithCounts = await Promise.all(
      deals.map(async (deal) => {
        const latestMilestone = await this.milestoneRepo.findOne({
          where: { tradeDealId: deal.id },
          order: { recordedAt: 'DESC' },
        });

        const documentCount = await this.documentRepo.count({
          where: { tradeDealId: deal.id },
        });

        return {
          id: deal.id,
          commodity: deal.commodity,
          quantity: deal.quantity,
          total_value: deal.totalValue,
          total_invested: deal.totalInvested,
          funded_amount: deal.totalInvested,
          status: deal.status,
          delivery_date: deal.deliveryDate,
          latest_milestone: latestMilestone || null,
          document_count: documentCount,
        };
      }),
    );

    return dealsWithCounts;
  }

  /**
   * Soft-delete a trade deal (admin only).
   * This preserves audit history while excluding the deal from standard queries.
   * Soft-deleted deals can be restored with restore().
   *
   * @param dealId  UUID of the deal to soft-delete
   * @returns       void (throws NotFoundException if deal doesn't exist)
   */
  async softDeleteDeal(dealId: string): Promise<void> {
    const deal = await this.tradeDealRepo.findOne({ where: { id: dealId } });
    if (!deal) {
      throw new NotFoundException('Trade deal not found.');
    }

    await this.tradeDealRepo.softDelete(dealId);
    this.logger.info({ dealId }, 'Trade deal soft-deleted by admin');
  }

  /**
   * Restore a soft-deleted trade deal (admin only).
   *
   * @param dealId  UUID of the deal to restore
   * @returns       void (throws NotFoundException if deal doesn't exist)
   */
  async restoreDeal(dealId: string): Promise<void> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      withDeleted: true,
    });

    if (!deal) {
      throw new NotFoundException('Trade deal not found.');
    }

    if (!deal.deletedAt) {
      this.logger.warn({ dealId }, 'Attempted restore on non-deleted deal');
      return;
    }

    await this.tradeDealRepo.restore(dealId);
    this.logger.info({ dealId }, 'Trade deal restored by admin');
  }

  private generateTokenSymbol(commodity: string, dealId: string): string {
    const commodityCode = commodity
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8);

    const dealShortId = dealId.replace(/-/g, '').slice(-4);
    return `${commodityCode}${dealShortId}`.slice(0, 12);
  }
}
