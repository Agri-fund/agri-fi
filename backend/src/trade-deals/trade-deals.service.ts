import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import {
  normalizePagination,
  PaginatedResult,
  toPaginatedResult,
} from '../common/pagination';

const VALID_DOC_TYPES: DocumentType[] = [
  'purchase_agreement',
  'bill_of_lading',
  'export_certificate',
  'warehouse_receipt',
];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface AddDocumentDto {
  tradeDealId: string;
  uploaderId: string;
  docType: string;
  ipfsHash: string;
  storageUrl: string;
  stellarTxId?: string | null;
  fileSizeBytes?: number;
  memoText?: string | null;
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
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TradeDealsService.name);
  }

  async updateDealStatus(
    dealId: string,
    status: TradeDealStatus,
    stellarAssetTxId?: string,
  ): Promise<void> {
    await this.tradeDealRepo.update(dealId, {
      status,
      ...(stellarAssetTxId && { stellarAssetTxId }),
    });
  }

  async createDeal(
    traderId: string,
    dto: CreateTradeDealDto,
  ): Promise<TradeDeal> {
    const farmer = await this.userRepo.findOne({
      where: { id: dto.farmer_id },
    });

    if (!farmer) {
      throw new NotFoundException('Farmer not found.');
    }

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
      commodity: dto.commodity,
      quantity: dto.quantity,
      quantityUnit: dto.quantity_unit,
      totalValue: dto.total_value,
      tokenCount,
      tokenSymbol: 'PENDING',
      status: 'draft',
      farmerId: dto.farmer_id,
      traderId,
      totalInvested: 0,
      deliveryDate: new Date(dto.delivery_date),
      escrowPublicKey: null,
      escrowSecretKey: null,
      issuerPublicKey: null,
      issuerSecretKey: null,
      stellarAssetTxId: null,
    });

    const savedDeal = await this.tradeDealRepo.save(tradeDeal);

    savedDeal.tokenSymbol = this.generateTokenSymbol(
      savedDeal.commodity,
      savedDeal.id,
    );

    return this.tradeDealRepo.save(savedDeal);
  }

  async findOpen(query: {
    commodity?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const skip = (page - 1) * limit;

    const qb = this.tradeDealRepo
      .createQueryBuilder('deal')
      .where('deal.status = :status', { status: 'open' })
      .select([
        'deal.id',
        'deal.commodity',
        'deal.quantity',
        'deal.quantityUnit',
        'deal.totalValue',
        'deal.totalInvested',
        'deal.tokenCount',
        'deal.tokenSymbol',
        'deal.deliveryDate',
        'deal.farmerId',
        'deal.traderId',
      ])
      .skip(skip)
      .take(limit);

    if (query.commodity) {
      qb.andWhere('LOWER(deal.commodity) = LOWER(:commodity)', {
        commodity: query.commodity,
      });
    }

    const [deals, total] = await qb.getManyAndCount();

    return {
      data: deals.map((deal) => ({
        id: deal.id,
        commodity: deal.commodity,
        quantity: deal.quantity,
        quantity_unit: deal.quantityUnit,
        total_value: deal.totalValue,
        total_invested: deal.totalInvested,
        token_count: deal.tokenCount,
        token_symbol: deal.tokenSymbol,
        delivery_date: deal.deliveryDate,
        farmer_id: deal.farmerId,
        trader_id: deal.traderId,
        remaining_funding: Number(deal.totalValue) - Number(deal.totalInvested),
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
      commodity: deal.commodity,
      quantity: deal.quantity,
      quantity_unit: deal.quantityUnit,
      total_value: deal.totalValue,
      delivery_date: deal.deliveryDate,
      status: deal.status,
      token_count: deal.tokenCount,
      token_symbol: deal.tokenSymbol,
      total_invested: deal.totalInvested,
      tokens_remaining: tokensRemaining,
      trader_name: deal.trader?.email || 'Unknown Trader',
      description: `${deal.quantity} ${deal.quantityUnit} of ${deal.commodity} for delivery by ${new Date(
        deal.deliveryDate,
      ).toLocaleDateString()}`,
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
        this.stellarService.encryptSecret(escrowSecretKey);

      // Update deal with escrow data
      await this.tradeDealRepo.update(dealId, {
        escrowPublicKey,
        escrowSecretKey: encryptedEscrowSecret,
      });

      this.logger.info(
        { dealId, escrowPublicKey },
        'Escrow account created, enqueuing token issuance',
      );

      // Enqueue the token issuance job
      await this.queueService.enqueueDealPublish({
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
    } catch (error) {
      this.logger.error(
        { dealId, error: error.message },
        'Failed to publish deal - escrow account creation failed',
      );

      // Deal remains in draft status on Stellar failure
      throw new UnprocessableEntityException({
        code: 'STELLAR_OPERATION_FAILED',
        message:
          'Failed to create escrow account. Please try again.',
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
      throw new Error('Deal is already canceled');
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
        const issuerSecret = this.stellarService.decryptSecret(
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

    if (confirmedInvestments.length > 0) {
      await this.investmentRepo.update(
        confirmedInvestments.map((inv) => inv.id),
        { status: InvestmentStatus.REFUNDED },
      );
      this.logger.info(
        { dealId, refundedCount: confirmedInvestments.length },
        'Refunded confirmed investments for canceled deal',
      );
    }

    deal.status = 'canceled';
    return this.tradeDealRepo.save(deal);
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

    // Get document count for each deal (placeholder - would need documents entity)
    const dealsWithCounts = await Promise.all(
      deals.map(async (deal) => {
        const latestMilestone = await this.milestoneRepo.findOne({
          where: { tradeDealId: deal.id },
          order: { recordedAt: 'DESC' },
        });

        return {
          id: deal.id,
          commodity: deal.commodity,
          quantity: deal.quantity,
          total_value: deal.totalValue,
          total_invested: deal.totalInvested,
          status: deal.status,
          delivery_date: deal.deliveryDate,
          latest_milestone: latestMilestone || null,
          document_count: 0, // TODO: Implement when documents entity is available
        };
      }),
    );

    return dealsWithCounts;
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
