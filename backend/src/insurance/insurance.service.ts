import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { StellarService } from '../stellar/stellar.service';
import { CreateInsuranceClaimDto } from './dto/create-insurance-claim.dto';
import { CreateInsuranceQuoteDto } from './dto/create-insurance-quote.dto';
import { InsuranceEventDto } from './dto/insurance-event.dto';
import { InsuranceProviderWebhookDto } from './dto/insurance-provider-webhook.dto';
import {
  InsuranceCoverageType,
  InsuranceQuote,
} from './entities/insurance-quote.entity';
import { InsurancePolicy } from './entities/insurance-policy.entity';
import { InsuranceClaim } from './entities/insurance-claim.entity';

interface InsuranceProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  webhookSecret: string;
}

interface ProviderQuote {
  quote_id: string;
  premium: number;
  coverage_amount: number;
  currency: string;
  terms: Record<string, unknown>;
  expires_at?: string;
}

const BASE_RATES: Record<InsuranceCoverageType, number> = {
  crop_failure: 0.035,
  shipment_damage: 0.02,
  price_fluctuation: 0.025,
};

const COMMODITY_VOLATILITY: Record<string, number> = {
  cocoa: 1.2,
  coffee: 1.18,
  sugar: 1.25,
  maize: 1.08,
  corn: 1.08,
  wheat: 1.12,
  rice: 1.05,
  soybeans: 1.12,
  cotton: 1.1,
};

@Injectable()
export class InsuranceService {
  private readonly logger = new Logger(InsuranceService.name);

  constructor(
    @InjectRepository(TradeDeal)
    private readonly dealRepository: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(InsuranceQuote)
    private readonly quoteRepository: Repository<InsuranceQuote>,
    @InjectRepository(InsurancePolicy)
    private readonly policyRepository: Repository<InsurancePolicy>,
    @InjectRepository(InsuranceClaim)
    private readonly claimRepository: Repository<InsuranceClaim>,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly stellarService: StellarService,
  ) {}

  async compareQuotes(
    user: User,
    dealId: string,
    dto: CreateInsuranceQuoteDto,
  ) {
    const deal = await this.getAuthorizedDeal(user, dealId);
    const providers = this.getProviders();
    if (!providers.length) {
      throw new ServiceUnavailableException(
        'No insurance providers are configured.',
      );
    }

    const riskScore = this.getRiskScore(deal);
    const coverageAmount =
      (Number(deal.totalValue) * (dto.coveragePercent ?? 100)) / 100;
    if (!Number.isFinite(coverageAmount) || coverageAmount <= 0) {
      throw new BadRequestException('Trade deal value must be positive.');
    }
    const indicativePremium = this.calculatePremium(
      deal,
      dto.coverageType,
      coverageAmount,
      riskScore,
    );

    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          const response = await this.post<ProviderQuote>(
            provider,
            '/v1/quotes',
            {
              client_reference: deal.id,
              commodity: deal.commodity,
              quantity: Number(deal.quantity),
              quantity_unit: deal.quantityUnit,
              total_value: Number(deal.totalValue),
              country: deal.farmer?.country,
              farm_location: deal.farmLocation,
              delivery_date: deal.deliveryDate,
              duration_days: deal.durationDays,
              coverage_type: dto.coverageType,
              requested_coverage_amount: Number(coverageAmount.toFixed(2)),
              indicative_premium: Number(indicativePremium.toFixed(2)),
              risk_score: riskScore,
            },
          );
          const normalized = this.normalizeQuote(response, coverageAmount);
          const quote = await this.quoteRepository.save(
            this.quoteRepository.create({
              tradeDealId: deal.id,
              createdBy: user.id,
              providerId: provider.id,
              providerQuoteId: normalized.quoteId,
              coverageType: dto.coverageType,
              coverageAmount: normalized.coverageAmount.toFixed(2),
              premium: normalized.premium.toFixed(2),
              currency: normalized.currency,
              terms: normalized.terms,
              riskScore: riskScore.toFixed(2),
              expiresAt: normalized.expiresAt,
              status: 'offered',
            }),
          );
          return {
            quoteId: quote.id,
            providerId: provider.id,
            providerName: provider.name,
            coverageType: quote.coverageType,
            coverageAmount: Number(quote.coverageAmount),
            premium: Number(quote.premium),
            currency: quote.currency,
            terms: quote.terms,
            expiresAt: quote.expiresAt,
          };
        } catch {
          this.logger.warn(
            { providerId: provider.id, dealId },
            'Insurance provider quote request failed',
          );
          return null;
        }
      }),
    );
    const quotes = results.filter(
      (quote): quote is NonNullable<typeof quote> => quote !== null,
    );
    if (!quotes.length) {
      throw new ServiceUnavailableException(
        'No configured insurance provider returned a valid quote.',
      );
    }

    const ranked = quotes
      .map((quote) => ({
        ...quote,
        valueScore:
          quote.coverageAmount > 0
            ? quote.coverageAmount / Math.max(quote.premium, 0.01)
            : 0,
      }))
      .sort(
        (left, right) =>
          right.valueScore - left.valueScore || left.premium - right.premium,
      );

    return {
      dealId,
      riskScore,
      indicativePremium: Number(indicativePremium.toFixed(2)),
      recommendedQuoteId: ranked[0].quoteId,
      recommendationReason:
        'Highest covered amount per premium among valid provider offers.',
      quotes: ranked,
      unavailableProviders: providers
        .filter(
          (provider) =>
            !quotes.some((quote) => quote.providerId === provider.id),
        )
        .map(({ id, name }) => ({ id, name })),
    };
  }

  async issuePolicy(user: User, quoteId: string): Promise<InsurancePolicy> {
    const quote = await this.quoteRepository.findOne({
      where: { id: quoteId },
    });
    if (!quote) throw new NotFoundException('Insurance quote not found.');
    const deal = await this.getAuthorizedDeal(user, quote.tradeDealId);
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Insurance quote has expired.');
    }
    if (quote.status !== 'offered') {
      throw new ConflictException('Insurance quote has already been issued.');
    }
    if (!this.config.get<string>('STELLAR_PLATFORM_SECRET')) {
      throw new ServiceUnavailableException(
        'Stellar policy anchoring is not configured.',
      );
    }

    const acquired = await this.quoteRepository.update(
      { id: quote.id, status: 'offered' },
      { status: 'issuing' },
    );
    if (!acquired.affected) {
      throw new ConflictException('Insurance quote is already being issued.');
    }

    const contract = {
      quoteId: quote.id,
      dealId: deal.id,
      providerId: quote.providerId,
      coverageType: quote.coverageType,
      coverageAmount: Number(quote.coverageAmount),
      premium: Number(quote.premium),
      currency: quote.currency,
      terms: quote.terms,
      issuedAt: new Date().toISOString(),
    };
    const contractHash = createHash('sha256')
      .update(JSON.stringify(contract))
      .digest('hex');

    let policy: InsurancePolicy;
    try {
      const provider = this.getProvider(quote.providerId);
      const response = await this.post<{
        policy_id: string;
        policy_number?: string;
      }>(
        provider,
        '/v1/policies',
        {
          quote_id: quote.providerQuoteId,
          client_reference: quote.id,
          contract_hash: contractHash,
        },
        `policy-${quote.id}`,
      );
      if (!response?.policy_id) {
        throw new Error('Provider response omitted policy_id');
      }
      policy = await this.policyRepository.save(
        this.policyRepository.create({
          quoteId: quote.id,
          tradeDealId: quote.tradeDealId,
          providerId: quote.providerId,
          providerPolicyId: response.policy_id,
          policyNumber: response.policy_number ?? null,
          coverageType: quote.coverageType,
          coverageAmount: quote.coverageAmount,
          currency: quote.currency,
          contract,
          contractHash,
          blockchainTxHash: null,
          status: 'anchor_pending',
        }),
      );
      quote.status = 'issued';
      await this.quoteRepository.save(quote);
    } catch {
      await this.quoteRepository.update(quote.id, { status: 'offered' });
      if (error instanceof ConflictException) throw error;
      this.logger.error(
        { providerId: quote.providerId, quoteId },
        'Policy issuance failed',
      );
      throw new BadGatewayException(
        'Insurance provider could not issue the policy.',
      );
    }

    return this.anchorPolicyRecord(policy);
  }

  async anchorPolicy(user: User, policyId: string): Promise<InsurancePolicy> {
    const policy = await this.policyRepository.findOne({
      where: { id: policyId },
    });
    if (!policy) throw new NotFoundException('Insurance policy not found.');
    await this.getAuthorizedDeal(user, policy.tradeDealId);
    return this.anchorPolicyRecord(policy);
  }

  private async anchorPolicyRecord(
    policy: InsurancePolicy,
  ): Promise<InsurancePolicy> {
    if (policy.status === 'active') return policy;
    if (policy.status !== 'anchor_pending') {
      throw new ConflictException(
        'Policy cannot be anchored in its current state.',
      );
    }
    const signerSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');
    if (!signerSecret) {
      throw new ServiceUnavailableException(
        'Stellar policy anchoring is not configured.',
      );
    }
    try {
      policy.blockchainTxHash = await this.stellarService.recordMemo(
        policy.contractHash,
        signerSecret,
        'hash',
      );
      policy.status = 'active';
      return await this.policyRepository.save(policy);
    } catch {
      this.logger.error(
        { policyId: policy.id },
        'Policy anchor submission failed',
      );
      throw new ServiceUnavailableException({
        message: 'Policy was issued but its Stellar anchor is pending retry.',
        policyId: policy.id,
      });
    }
  }

  async createClaim(
    user: User,
    policyId: string,
    dto: CreateInsuranceClaimDto,
  ): Promise<InsuranceClaim> {
    const policy = await this.policyRepository.findOne({
      where: { id: policyId },
    });
    if (!policy) throw new NotFoundException('Insurance policy not found.');
    await this.getAuthorizedDeal(user, policy.tradeDealId);
    return this.submitClaim(policy, dto);
  }

  async triggerClaims(dto: InsuranceEventDto, signature: string) {
    const secret = this.config.get<string>(
      'INSURANCE_EVENT_WEBHOOK_SECRET',
      '',
    );
    this.verifySignature(dto, signature, secret);
    const policies = await this.policyRepository.find({
      where: { tradeDealId: dto.dealId, status: 'active' },
    });
    const occurredAt = new Date(dto.occurredAt);
    if (occurredAt.getTime() > Date.now()) {
      throw new BadRequestException(
        'Covered event cannot occur in the future.',
      );
    }
    const matching = policies.filter(
      (policy) =>
        policy.coverageType === dto.eventType &&
        policy.createdAt.getTime() <= occurredAt.getTime() &&
        Number(policy.coverageAmount) > 0,
    );
    const claims = await Promise.all(
      matching.map(async (policy) => {
        try {
          return await this.submitClaim(policy, {
            eventId: dto.eventId,
            eventType: dto.eventType,
            amount: Math.min(dto.lossAmount, Number(policy.coverageAmount)),
            evidence: [`event:${dto.eventId}`, `occurred_at:${dto.occurredAt}`],
          });
        } catch {
          if (error instanceof ConflictException) throw error;
          return { policyId: policy.id, status: 'submission_failed' };
        }
      }),
    );
    return { dealId: dto.dealId, eventId: dto.eventId, claims };
  }

  private async submitClaim(
    policy: InsurancePolicy,
    dto: CreateInsuranceClaimDto,
  ): Promise<InsuranceClaim> {
    if (policy.status !== 'active') {
      throw new ConflictException('Claims require an active anchored policy.');
    }
    if (dto.eventType !== policy.coverageType) {
      throw new BadRequestException(
        'Event type is not covered by this policy.',
      );
    }
    if (dto.amount > Number(policy.coverageAmount)) {
      throw new BadRequestException('Claim amount exceeds policy coverage.');
    }
    const existing = await this.claimRepository.findOne({
      where: { policyId: policy.id, eventId: dto.eventId },
    });
    if (existing) {
      if (
        existing.eventType !== dto.eventType ||
        Number(existing.amount) !== dto.amount
      ) {
        throw new ConflictException(
          'This event ID is already associated with a different claim.',
        );
      }
      if (existing.status === 'submission_failed') {
        return this.sendClaimToProvider(existing, policy);
      }
      return existing;
    }

    let claim: InsuranceClaim;
    try {
      claim = await this.claimRepository.save(
        this.claimRepository.create({
          policyId: policy.id,
          tradeDealId: policy.tradeDealId,
          providerId: policy.providerId,
          eventId: dto.eventId,
          eventType: dto.eventType,
          amount: dto.amount.toFixed(2),
          approvedAmount: null,
          evidence: dto.evidence ?? [],
          providerClaimId: null,
          providerPayoutId: null,
          payoutTxHash: null,
          status: 'submitted',
        }),
      );
    } catch (error: any) {
      if (error?.code === '23505') {
        const duplicate = await this.claimRepository.findOne({
          where: { policyId: policy.id, eventId: dto.eventId },
        });
        if (
          duplicate &&
          duplicate.eventType === dto.eventType &&
          Number(duplicate.amount) === dto.amount
        ) {
          return duplicate;
        }
        throw new ConflictException(
          'This event ID is already associated with a different claim.',
        );
      }
      throw error;
    }
    return this.sendClaimToProvider(claim, policy);
  }

  private async sendClaimToProvider(
    claim: InsuranceClaim,
    policy: InsurancePolicy,
  ): Promise<InsuranceClaim> {
    try {
      const response = await this.post<{ claim_id: string }>(
        this.getProvider(claim.providerId),
        '/v1/claims',
        {
          client_reference: claim.id,
          policy_id: policy.providerPolicyId,
          event_id: claim.eventId,
          event_type: claim.eventType,
          loss_amount: Number(claim.amount),
          currency: policy.currency,
          evidence: claim.evidence,
        },
        `claim-${claim.id}`,
      );
      if (!response?.claim_id)
        throw new Error('Provider response omitted claim_id');
      claim.providerClaimId = response.claim_id;
      claim.status = 'submitted';
      return await this.claimRepository.save(claim);
    } catch {
      claim.status = 'submission_failed';
      await this.claimRepository.save(claim);
      this.logger.error(
        { claimId: claim.id },
        'Insurance claim submission failed',
      );
      throw new BadGatewayException(
        'Insurance provider could not accept the claim.',
      );
    }
  }

  async handleProviderWebhook(
    providerId: string,
    dto: InsuranceProviderWebhookDto,
    signature: string,
  ) {
    const provider = this.getProvider(providerId);
    this.verifySignature(dto, signature, provider.webhookSecret);
    const claim = await this.claimRepository.findOne({
      where: { id: dto.claimId, providerId },
    });
    if (!claim) throw new NotFoundException('Insurance claim not found.');
    if (claim.providerClaimId !== dto.providerClaimId) {
      throw new ForbiddenException('Provider claim reference does not match.');
    }

    if (dto.status === 'rejected') {
      if (claim.status === 'paid') {
        throw new ConflictException('A paid claim cannot be rejected.');
      }
      claim.status = 'rejected';
      await this.claimRepository.save(claim);
      return claim;
    }

    if (dto.status === 'approved') {
      if (claim.status === 'payout_pending' || claim.status === 'paid') {
        return claim;
      }
      if (!['submitted', 'approved'].includes(claim.status)) {
        throw new ConflictException(
          'Claim cannot be approved in its current state.',
        );
      }
      const approvedAmount = dto.approvedAmount ?? Number(claim.amount);
      if (approvedAmount > Number(claim.amount)) {
        throw new BadRequestException(
          'Approved amount exceeds the submitted claim.',
        );
      }
      claim.approvedAmount = approvedAmount.toFixed(2);
      claim.status = 'approved';
      await this.claimRepository.save(claim);
      return this.initiatePayout(claim);
    }

    return this.completePayout(claim, dto);
  }

  private async initiatePayout(claim: InsuranceClaim): Promise<InsuranceClaim> {
    const deal = await this.dealRepository.findOne({
      where: { id: claim.tradeDealId },
    });
    if (!deal) throw new NotFoundException('Trade deal not found.');
    const farmer = await this.userRepository.findOne({
      where: { id: deal.farmerId },
    });
    if (!farmer?.walletAddress) {
      throw new ConflictException('Farmer has no Stellar payout wallet.');
    }
    const escrowSecret = this.config.get<string>(
      'INSURANCE_PAYOUT_ESCROW_SECRET',
      '',
    );
    if (!escrowSecret) {
      throw new ServiceUnavailableException(
        'Insurance payout escrow is not configured.',
      );
    }
    if (claim.status === 'payout_pending' && claim.providerPayoutId)
      return claim;
    const response = await this.post<{ payout_id: string }>(
      this.getProvider(claim.providerId),
      '/v1/payouts',
      {
        client_reference: claim.id,
        claim_id: claim.providerClaimId,
        amount: Number(claim.approvedAmount),
        currency: 'USD',
        destination:
          this.stellarService.getInsuranceEscrowPublicKey(escrowSecret),
      },
      `payout-${claim.id}`,
    );
    if (!response?.payout_id)
      throw new BadGatewayException('Provider omitted payout_id.');
    claim.providerPayoutId = response.payout_id;
    claim.status = 'payout_pending';
    return this.claimRepository.save(claim);
  }

  private async completePayout(
    claim: InsuranceClaim,
    dto: InsuranceProviderWebhookDto,
  ): Promise<InsuranceClaim> {
    if (claim.status === 'paid') return claim;
    if (claim.status !== 'payout_pending' || !claim.providerPayoutId) {
      throw new ConflictException('Claim has no pending insurer payout.');
    }
    if (dto.payoutId !== claim.providerPayoutId) {
      throw new ForbiddenException('Provider payout reference does not match.');
    }
    const payoutAmount = dto.payoutAmount ?? Number(claim.approvedAmount);
    if (payoutAmount !== Number(claim.approvedAmount)) {
      throw new BadRequestException(
        'Confirmed payout must match the approved amount.',
      );
    }
    const deal = await this.dealRepository.findOne({
      where: { id: claim.tradeDealId },
    });
    const farmer = deal
      ? await this.userRepository.findOne({ where: { id: deal.farmerId } })
      : null;
    if (!farmer?.walletAddress) {
      throw new ConflictException('Farmer has no Stellar payout wallet.');
    }

    const acquired = await this.claimRepository.update(
      { id: claim.id, status: 'payout_pending' },
      { status: 'payout_processing' },
    );
    if (!acquired.affected) {
      return this.claimRepository.findOneOrFail({ where: { id: claim.id } });
    }
    try {
      claim.payoutTxHash = await this.stellarService.releaseInsurancePayout(
        this.config.get<string>('INSURANCE_PAYOUT_ESCROW_SECRET', ''),
        farmer.walletAddress,
        payoutAmount,
        claim.id,
      );
      claim.status = 'paid';
      return await this.claimRepository.save(claim);
    } catch {
      this.logger.error(
        { claimId: claim.id },
        'Insurance payout release failed',
      );
      throw new ServiceUnavailableException(
        'Insurer funds were confirmed, but payout status requires reconciliation before retry.',
      );
    }
  }

  async getAnalytics(user: User) {
    if (!['admin', 'company_admin'].includes(user.role)) {
      throw new ForbiddenException(
        'Insurance analytics are restricted to admins.',
      );
    }
    const providers = this.getProviders();
    const analytics = await Promise.all(
      providers.map(async ({ id, name }) => {
        const [policyCount, claimCount, paidClaims, premiumTotal, payoutTotal] =
          await Promise.all([
            this.policyRepository.count({ where: { providerId: id } }),
            this.claimRepository.count({ where: { providerId: id } }),
            this.claimRepository.count({
              where: { providerId: id, status: 'paid' },
            }),
            this.policyRepository
              .createQueryBuilder('policy')
              .innerJoin('policy.quote', 'quote')
              .select('COALESCE(SUM(quote.premium), 0)', 'total')
              .where('policy.providerId = :id', { id })
              .andWhere("policy.status = 'active'")
              .getRawOne<{ total: string }>(),
            this.claimRepository
              .createQueryBuilder('claim')
              .select('COALESCE(SUM(claim.approved_amount), 0)', 'total')
              .where('claim.providerId = :id', { id })
              .andWhere("claim.status = 'paid'")
              .getRawOne<{ total: string }>(),
          ]);
        return {
          providerId: id,
          providerName: name,
          policyCount,
          claimCount,
          claimRate: policyCount ? claimCount / policyCount : 0,
          paidClaims,
          premiumTotal: Number(premiumTotal?.total ?? 0),
          payoutTotal: Number(payoutTotal?.total ?? 0),
          payoutRatio:
            Number(premiumTotal?.total ?? 0) > 0
              ? Number(payoutTotal?.total ?? 0) / Number(premiumTotal.total)
              : 0,
        };
      }),
    );
    return { providers: analytics };
  }

  private async getAuthorizedDeal(
    user: User,
    dealId: string,
  ): Promise<TradeDeal> {
    const deal = await this.dealRepository.findOne({
      where: { id: dealId },
      relations: ['farmer'],
    });
    if (!deal) throw new NotFoundException('Trade deal not found.');
    if (
      !['admin', 'company_admin'].includes(user.role) &&
      deal.farmerId !== user.id &&
      deal.traderId !== user.id
    ) {
      throw new ForbiddenException(
        'You cannot access insurance for this deal.',
      );
    }
    return deal;
  }

  private getRiskScore(deal: TradeDeal): number {
    const score =
      deal.riskScore === null || deal.riskScore === undefined
        ? Number.NaN
        : Number(deal.riskScore);
    return Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 50;
  }

  private calculatePremium(
    deal: TradeDeal,
    coverageType: InsuranceCoverageType,
    coverageAmount: number,
    riskScore: number,
  ): number {
    const durationFactor = Math.min(
      2,
      Math.max(0.5, Number(deal.durationDays ?? 90) / 90),
    );
    const commodityFactor =
      COMMODITY_VOLATILITY[deal.commodity.toLowerCase()] ?? 1.1;
    const riskFactor = 0.75 + riskScore / 100;
    return (
      coverageAmount *
      BASE_RATES[coverageType] *
      riskFactor *
      durationFactor *
      commodityFactor
    );
  }

  private normalizeQuote(
    response: ProviderQuote,
    requestedCoverage: number,
  ): {
    quoteId: string;
    premium: number;
    coverageAmount: number;
    currency: string;
    terms: Record<string, unknown>;
    expiresAt: Date;
  } {
    const premium = Number(response?.premium);
    const coverageAmount = Number(response?.coverage_amount);
    const currency = String(response?.currency ?? '').toUpperCase();
    const expiresAt = response?.expires_at
      ? new Date(response.expires_at)
      : new Date(Date.now() + 15 * 60 * 1000);
    if (
      !response?.quote_id ||
      !Number.isFinite(premium) ||
      premium < 0 ||
      !Number.isFinite(coverageAmount) ||
      coverageAmount <= 0 ||
      coverageAmount > requestedCoverage ||
      currency !== 'USD' ||
      !response.terms ||
      typeof response.terms !== 'object' ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      throw new Error('Invalid quote response');
    }
    return {
      quoteId: response.quote_id,
      premium,
      coverageAmount,
      currency,
      terms: response.terms,
      expiresAt,
    };
  }

  private getProviders(): InsuranceProvider[] {
    const raw = this.config.get<string>('INSURANCE_PROVIDERS', '[]');
    let providers: InsuranceProvider[];
    try {
      providers = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException(
        'INSURANCE_PROVIDERS is not valid JSON.',
      );
    }
    if (!Array.isArray(providers)) {
      throw new ServiceUnavailableException(
        'INSURANCE_PROVIDERS must be a JSON array.',
      );
    }
    const ids = new Set<string>();
    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') {
        throw new ServiceUnavailableException(
          'Insurance provider configuration entries must be objects.',
        );
      }
      let url: URL;
      try {
        url = new URL(provider.baseUrl);
      } catch {
        throw new ServiceUnavailableException(
          'An insurance provider URL is invalid.',
        );
      }
      if (
        !provider.id ||
        typeof provider.id !== 'string' ||
        !provider.name ||
        typeof provider.name !== 'string' ||
        !provider.apiKey ||
        typeof provider.apiKey !== 'string' ||
        !provider.webhookSecret ||
        typeof provider.webhookSecret !== 'string' ||
        ids.has(provider.id) ||
        url.protocol !== 'https:' ||
        url.username ||
        url.password
      ) {
        throw new ServiceUnavailableException(
          'Insurance providers require unique IDs, credentials, webhook secrets, and HTTPS base URLs.',
        );
      }
      ids.add(provider.id);
    }
    return providers;
  }

  private getProvider(providerId: string): InsuranceProvider {
    const provider = this.getProviders().find(
      (candidate) => candidate.id === providerId,
    );
    if (!provider)
      throw new NotFoundException('Insurance provider is not configured.');
    return provider;
  }

  private async post<T>(
    provider: InsuranceProvider,
    path: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    const timeout = Math.min(
      30_000,
      Math.max(
        1_000,
        Number(this.config.get('INSURANCE_HTTP_TIMEOUT_MS', 10_000)),
      ),
    );
    const response = await firstValueFrom(
      this.httpService.post<T>(
        `${provider.baseUrl.replace(/\/$/, '')}${path}`,
        body,
        {
          timeout,
          maxRedirects: 0,
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
        },
      ),
    );
    return response.data;
  }

  private verifySignature(
    payload: unknown,
    signature: string,
    secret: string,
  ): void {
    if (!secret || !signature) {
      throw new ForbiddenException(
        'Insurance webhook signature is not configured.',
      );
    }
    const expected = createHmac('sha256', secret)
      .update(this.canonicalize(payload))
      .digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
    } catch {
      throw new ForbiddenException('Insurance webhook signature is invalid.');
    }
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new ForbiddenException('Insurance webhook signature is invalid.');
    }
  }

  private canonicalize(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalize(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const entries = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${this.canonicalize(record[key])}`,
        );
      return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }
}
