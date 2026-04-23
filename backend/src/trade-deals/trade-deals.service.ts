import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeDeal, TradeDealStatus } from './entities/trade-deal.entity';
import { Document, DocumentType } from './entities/document.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { CreateTradeDealDto } from './dto/create-trade-deal.dto';
import { User } from '../auth/entities/user.entity';

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
  ) {}

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

  async saveEscrowKeys(
    dealId: string,
    escrowPublicKey: string,
    escrowSecretKey: string,
  ): Promise<void> {
    await this.tradeDealRepo.update(dealId, { escrowPublicKey, escrowSecretKey });
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
  }): Promise<any[]> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
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

    const deals = await qb.getMany();

    return deals.map((deal) => ({
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
    }));
  }

  async findOne(id: string): Promise<any> {
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

    return {
      id: deal.id,
      commodity: deal.commodity,
      quantity: deal.quantity,
      unit: deal.quantityUnit,
      totalValue: deal.totalValue,
      deliveryDate: deal.deliveryDate,
      status: deal.status,
      tokenCount: deal.tokenCount,
      tokenSymbol: deal.tokenSymbol,
      totalInvested: deal.totalInvested,
      farmerId: deal.farmerId,
      traderId: deal.traderId,
      tokensRemaining,
      traderName: deal.trader?.email || 'Unknown Trader',
      description: `${deal.quantity} ${deal.quantityUnit} of ${deal.commodity} for delivery by ${new Date(
        deal.deliveryDate,
      ).toLocaleDateString()}`,
      documents: deal.documents ?? [],
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        milestone: milestone.milestone,
        notes: milestone.notes,
        stellarTxId: milestone.stellarTxId,
        recordedBy: milestone.recordedBy,
        recordedAt: milestone.recordedAt,
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

    return deal;
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
    });

    return this.documentRepo.save(doc);
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
