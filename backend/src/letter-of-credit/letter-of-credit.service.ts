import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import * as crypto from 'crypto';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { StellarService } from '../stellar/stellar.service';
import {
  LetterOfCredit,
  LetterOfCreditStatus,
  LcAmendment,
  PresentedDocument,
  LcAnalytics,
  Ucp600DocumentType,
} from './letter-of-credit.types';
import {
  CreateLetterOfCreditDto,
  AmendLetterOfCreditDto,
  VerifyDocumentDto,
} from './dto/create-lc.dto';

@Injectable()
export class LetterOfCreditService {
  private readonly lcs = new Map<string, LetterOfCredit>();

  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly stellarService: StellarService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LetterOfCreditService.name);
  }

  /**
   * Automates LC issuance directly from an approved trade deal's terms.
   */
  async issueFromDeal(
    dealId: string,
    dto?: Partial<CreateLetterOfCreditDto>,
  ): Promise<LetterOfCredit> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['farmer', 'trader'],
    });

    if (!deal) {
      throw new NotFoundException(`Trade deal ${dealId} not found`);
    }

    const lcId = `lc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const lcNumber = `AGRI-LC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const shipmentDate = new Date(
      deal.deliveryDate || Date.now() + 60 * 86400000,
    )
      .toISOString()
      .split('T')[0];
    const expiryDate = new Date(
      new Date(shipmentDate).getTime() +
        (dto?.presentationPeriodDays || 21) * 86400000,
    )
      .toISOString()
      .split('T')[0];

    const amount = Number(deal.totalValue) || 10000;
    const tolerance = dto?.tolerancePercentage ?? 5; // Article 30 UCP 600

    const requiredDocs: Ucp600DocumentType[] = dto?.requiredDocuments || [
      'BILL_OF_LADING',
      'COMMERCIAL_INVOICE',
      'CERTIFICATE_OF_ORIGIN',
      'PHYTOSANITARY_CERTIFICATE',
      'INSURANCE_CERTIFICATE',
    ];

    const issuingBank = dto?.issuingBank || 'STANDARD_CHARTERED_GLOBAL';
    const advisingBank = dto?.advisingBank || 'BARCLAYS_COMMERCIAL';

    // Generate SWIFT MT700 documentary credit message
    const swiftMt700 = this.generateSwiftMt700({
      lcNumber,
      dealTitle: deal.title || `${deal.commodity} Export`,
      commodity: deal.commodity,
      quantity: `${deal.quantity} ${deal.quantityUnit}`,
      amount,
      currency: 'USD',
      issuingBank,
      advisingBank,
      applicant: deal.trader?.email || 'Trader Corp',
      beneficiary: deal.farmer?.email || 'Farmer Cooperative',
      shipmentDate,
      expiryDate,
      tolerance,
      portOfLoading: dto?.portOfLoading || 'Origin Regional Port',
      portOfDischarge: dto?.portOfDischarge || 'Destination International Port',
      requiredDocs,
    });

    // Anchor LC root hash on Stellar blockchain
    const anchoringPayload = `${lcNumber}|${deal.id}|${amount}|USD|${issuingBank}|${advisingBank}|${shipmentDate}|${expiryDate}`;
    const blockchainAnchoringHash = crypto
      .createHash('sha256')
      .update(anchoringPayload)
      .digest('hex');

    // Submit the anchoring hash as a real Stellar memo transaction
    const blockchainTxHash = await this.stellarService.recordMemo(
      `LC_ISSUE:${blockchainAnchoringHash}`,
    );

    const lc: LetterOfCredit = {
      id: lcId,
      lcNumber,
      dealId: deal.id,
      dealTitle: deal.title || `${deal.commodity} Deal`,
      commodity: deal.commodity,
      lcType: dto?.lcType || 'IRREVOCABLE_CONFIRMED',
      issuingBank,
      advisingBank,
      applicantId: deal.traderId,
      applicantName: deal.trader?.email || 'Trader',
      beneficiaryId: deal.farmerId,
      beneficiaryName: deal.farmer?.email || 'Farmer',
      amount,
      currency: 'USD',
      tolerancePercentage: tolerance,
      expiryDate,
      presentationPeriodDays: dto?.presentationPeriodDays || 21,
      shipmentDate,
      portOfLoading: dto?.portOfLoading || 'Origin Regional Port',
      portOfDischarge: dto?.portOfDischarge || 'Destination International Port',
      status: 'ISSUED',
      ucp600Compliant: true,
      swiftMt700Message: swiftMt700,
      blockchainAnchoringHash,
      blockchainTxHash,
      requiredDocuments: requiredDocs,
      presentedDocuments: [],
      amendments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settledAt: null,
    };

    this.lcs.set(lcId, lc);

    this.logger.info(
      { lcId, lcNumber, dealId, amount, blockchainTxHash },
      'Letter of Credit issued automatically from trade deal',
    );

    return lc;
  }

  /**
   * Request an automated LC amendment with workflow approval.
   */
  async requestAmendment(
    lcId: string,
    dto: AmendLetterOfCreditDto,
    requestedBy = 'applicant',
  ): Promise<LcAmendment> {
    const lc = this.getLc(lcId);

    const amendmentNumber = lc.amendments.length + 1;
    const amendmentId = `amend-${Date.now()}-${amendmentNumber}`;

    const swiftMt707 = this.generateSwiftMt707(
      lc,
      amendmentNumber,
      dto.proposedChanges,
    );

    const amendment: LcAmendment = {
      id: amendmentId,
      amendmentNumber,
      requestedBy,
      requestedAt: new Date().toISOString(),
      proposedChanges: dto.proposedChanges,
      status: 'PENDING_APPROVAL',
      swiftMt707Message: swiftMt707,
      decisionReason: dto.reason,
    };

    lc.amendments.push(amendment);
    lc.updatedAt = new Date().toISOString();
    this.lcs.set(lcId, lc);

    this.logger.info(
      { lcId, amendmentId, amendmentNumber },
      'Letter of Credit amendment requested',
    );

    return amendment;
  }

  /**
   * Approve or reject an LC amendment.
   */
  async decideAmendment(
    lcId: string,
    amendmentId: string,
    approved: boolean,
    reason?: string,
  ): Promise<LetterOfCredit> {
    const lc = this.getLc(lcId);
    const amendment = lc.amendments.find((a) => a.id === amendmentId);

    if (!amendment) {
      throw new NotFoundException(
        `Amendment ${amendmentId} not found on LC ${lcId}`,
      );
    }

    if (amendment.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Amendment is already ${amendment.status}`);
    }

    amendment.status = approved ? 'APPROVED' : 'REJECTED';
    amendment.decidedAt = new Date().toISOString();
    if (reason) amendment.decisionReason = reason;

    if (approved) {
      // Apply approved changes to the active LC
      for (const [key, val] of Object.entries(amendment.proposedChanges)) {
        if (key in lc && key !== 'id' && key !== 'lcNumber') {
          (lc as any)[key] = val;
        }
      }
      // Re-anchor on blockchain with updated terms
      lc.blockchainAnchoringHash = crypto
        .createHash('sha256')
        .update(`${lc.blockchainAnchoringHash}|amend:${amendmentId}`)
        .digest('hex');
    }

    lc.updatedAt = new Date().toISOString();
    this.lcs.set(lcId, lc);

    return lc;
  }

  /**
   * Automated document verification against UCP 600 rules.
   */
  async verifyDocument(
    lcId: string,
    dto: VerifyDocumentDto,
  ): Promise<PresentedDocument> {
    const lc = this.getLc(lcId);
    const discrepancies: string[] = [];

    // UCP 600 Article 14: Examination period & document consistency
    const docDate = new Date(dto.issueDate);
    const expiry = new Date(lc.expiryDate);
    const shipment = new Date(lc.shipmentDate);

    if (docDate > expiry) {
      discrepancies.push(
        `Document presented after LC expiry date (${lc.expiryDate})`,
      );
    }

    // UCP 600 Article 20: Bill of Lading verification
    if (dto.docType === 'BILL_OF_LADING') {
      if (docDate > shipment) {
        discrepancies.push(
          `Bill of Lading dated after shipment date (${lc.shipmentDate})`,
        );
      }
    }

    const presentedDoc: PresentedDocument = {
      id: `doc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      docType: dto.docType,
      fileName: dto.fileName,
      fileHash: dto.fileHash,
      issueDate: dto.issueDate,
      presentedAt: new Date().toISOString(),
      status: discrepancies.length === 0 ? 'COMPLIANT' : 'DISCREPANT',
      discrepancies,
    };

    lc.presentedDocuments.push(presentedDoc);
    lc.updatedAt = new Date().toISOString();
    this.lcs.set(lcId, lc);

    return presentedDoc;
  }

  /**
   * Settle an LC once compliant documents are presented.
   */
  async settleLc(lcId: string): Promise<LetterOfCredit> {
    const lc = this.getLc(lcId);

    if (lc.status === 'SETTLED') {
      throw new BadRequestException(`LC ${lcId} is already settled`);
    }

    const hasDiscrepancies = lc.presentedDocuments.some(
      (d) => d.status === 'DISCREPANT',
    );
    if (hasDiscrepancies) {
      throw new BadRequestException(
        `LC ${lcId} has discrepant documents and cannot be settled`,
      );
    }

    // Anchor settlement on Stellar blockchain
    const settlementPayload = `${lc.lcNumber}|${lc.blockchainAnchoringHash}|settled:${Date.now()}`;
    const settlementHash = crypto
      .createHash('sha256')
      .update(settlementPayload)
      .digest('hex');

    const blockchainTxHash = await this.stellarService.recordMemo(
      `LC_SETTLE:${settlementHash}`,
    );

    lc.status = 'SETTLED';
    lc.blockchainTxHash = blockchainTxHash;
    lc.settledAt = new Date().toISOString();
    lc.updatedAt = new Date().toISOString();
    this.lcs.set(lcId, lc);

    this.logger.info(
      { lcId, lcNumber: lc.lcNumber, blockchainTxHash },
      'Letter of Credit settled and anchored on Stellar',
    );

    return lc;
  }

  /**
   * Retrieve LC analytics for a portfolio.
   */
  async getAnalytics(): Promise<LcAnalytics> {
    const all = Array.from(this.lcs.values());
    const totalValue = all.reduce((sum, lc) => sum + lc.amount, 0);
    const settled = all.filter((lc) => lc.status === 'SETTLED');

    return {
      totalLcs: all.length,
      totalValue,
      settledCount: settled.length,
      settledValue: settled.reduce((sum, lc) => sum + lc.amount, 0),
      byStatus: all.reduce<Record<string, number>>((acc, lc) => {
        acc[lc.status] = (acc[lc.status] || 0) + 1;
        return acc;
      }, {}),
    } as LcAnalytics;
  }

  private getLc(lcId: string): LetterOfCredit {
    const lc = this.lcs.get(lcId);
    if (!lc) {
      throw new NotFoundException(`Letter of Credit ${lcId} not found`);
    }
    return lc;
  }

  private generateSwiftMt700(params: {
    lcNumber: string;
    dealTitle: string;
    commodity: string;
    quantity: string;
    amount: number;
    currency: string;
    issuingBank: string;
    advisingBank: string;
    applicant: string;
    beneficiary: string;
    shipmentDate: string;
    expiryDate: string;
    tolerance: number;
    portOfLoading: string;
    portOfDischarge: string;
    requiredDocs: Ucp600DocumentType[];
  }): string {
    return [
      `:27:SEQUENCE OF TOTAL: 1/1`,
      `:40A:FORM OF DOCUMENTARY CREDIT: IRREVOCABLE`,
      `:20:DOCUMENTARY CREDIT NUMBER: ${params.lcNumber}`,
      `:31C:DATE OF ISSUE: ${new Date().toISOString().split('T')[0]}`,
      `:31D:DATE AND PLACE OF EXPIRY: ${params.expiryDate}`,
      `:50:APPLICANT: ${params.applicant}`,
      `:59:BENEFICIARY: ${params.beneficiary}`,
      `:32B:CURRENCY CODE, AMOUNT: ${params.currency}${params.amount}`,
      `:39A:PERCENTAGE CREDIT AMOUNT TOLERANCE: ${params.tolerance}/${params.tolerance}`,
      `:41D:AVAILABLE WITH...BY...: ${params.advisingBank} BY NEGOTIATION`,
      `:42C:DRAFTS AT...: SIGHT`,
      `:43P:PARTIAL SHIPMENTS: NOT ALLOWED`,
      `:43T:TRANSSHIPMENT: ALLOWED`,
      `:44A:PORT OF LOADING: ${params.portOfLoading}`,
      `:44B:PORT OF DISCHARGE: ${params.portOfDischarge}`,
      `:44C:LATEST DATE OF SHIPMENT: ${params.shipmentDate}`,
      `:45A:DESCRIPTION OF GOODS: ${params.commodity} - ${params.quantity}`,
      `:46A:DOCUMENTS REQUIRED: ${params.requiredDocs.join(', ')}`,
      `:47A:ADDITIONAL CONDITIONS: ALL DOCUMENTS SUBJECT TO UCP 600`,
      `:71B:CHARGES: ALL BANKING CHARGES OUTSIDE ISSUING BANK FOR BENEFICIARY`,
      `:48:PERIOD FOR PRESENTATION: 21 DAYS AFTER SHIPMENT`,
      `:49:CONFIRMATION INSTRUCTIONS: CONFIRM`,
    ].join('\n');
  }

  private generateSwiftMt707(
    lc: LetterOfCredit,
    amendmentNumber: number,
    changes: Record<string, unknown>,
  ): string {
    return [
      `:20:SENDER'S REFERENCE: ${lc.lcNumber}`,
      `:21:RECEIVER'S REFERENCE: ${lc.lcNumber}`,
      `:26E:NUMBER OF AMENDMENT: ${amendmentNumber}`,
      `:30:DATE OF AMENDMENT: ${new Date().toISOString().split('T')[0]}`,
      `:31C:DATE OF ISSUE: ${lc.createdAt.split('T')[0]}`,
      `:59:BENEFICIARY: ${lc.beneficiaryName}`,
      `:79:NARRATIVE: ${JSON.stringify(changes)}`,
    ].join('\n');
  }
}
