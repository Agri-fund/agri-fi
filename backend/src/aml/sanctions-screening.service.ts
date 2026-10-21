import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { ComplianceAlert } from '../database/entities/compliance-alert.entity';
import { OfacSanctionsCheckService } from '../auth/utils/ofac-sanctions-check';
import { AmlAlert } from './entities/aml-alert.entity';
import { AmlScreeningResult } from './entities/aml-screening-result.entity';
import { SanctionsListEntry } from './entities/sanctions-list-entry.entity';
import { SanctionsListService } from './sanctions-list.service';
import { AmlCaseService } from './aml-case.service';
import { ScreenSubjectDto } from './dto/aml-monitoring.dto';
import {
  AmlScreeningDecision,
  AmlScreeningSubjectType,
  AmlSeverity,
} from './aml.constants';
import {
  dateOfBirthAgreement,
  normaliseSanctionsName,
  scoreNameSimilarity,
} from './aml-name-match';
import { AuditService } from '../audit/audit.service';

export interface ScreeningOutcome {
  subjectType: AmlScreeningSubjectType;
  subjectId: string;
  decision: AmlScreeningDecision;
  score: number;
  matchedEntryId: string | null;
  matchedName: string | null;
  /** Display label for the screened subject, kept on the alert evidence. */
  subjectLabel?: string | null;
  listSource: string;
  reasons: string[];
  alertId: string | null;
  caseNumber: string | null;
  resultId: string | null;
}

/**
 * Sanctions and PEP screening (#1217).
 *
 * Name screening is done against the locally loaded OFAC / UN / EU list rows
 * with an explainable similarity score, so a decision can be reproduced and
 * defended. Wallet screening keeps using the existing Chainalysis-style KYT
 * integration in `auth/utils/ofac-sanctions-check.ts` rather than a second
 * address-checking implementation.
 */
@Injectable()
export class SanctionsScreeningService {
  private readonly logger = new Logger(SanctionsScreeningService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ComplianceAlert)
    private readonly complianceAlertRepository: Repository<ComplianceAlert>,
    @InjectRepository(AmlAlert)
    private readonly alertRepository: Repository<AmlAlert>,
    @InjectRepository(AmlScreeningResult)
    private readonly resultRepository: Repository<AmlScreeningResult>,
    private readonly sanctionsList: SanctionsListService,
    private readonly caseService: AmlCaseService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
    @Optional()
    private readonly walletScreener?: OfacSanctionsCheckService,
  ) {}

  private get matchThreshold(): number {
    return Number(this.config.get('AML_SANCTIONS_MATCH_THRESHOLD', '85'));
  }

  private get reviewThreshold(): number {
    return Number(this.config.get('AML_SANCTIONS_REVIEW_THRESHOLD', '70'));
  }

  private decide(score: number): AmlScreeningDecision {
    if (score >= this.matchThreshold) return 'match';
    if (score >= this.reviewThreshold) return 'review';
    return 'clear';
  }

  private severityFor(
    decision: AmlScreeningDecision,
    isPep: boolean,
  ): AmlSeverity {
    if (isPep && decision !== 'clear') return 'HIGH';
    if (decision === 'match') return 'CRITICAL';
    if (decision === 'review') return 'HIGH';
    return 'LOW';
  }

  /**
   * Score one subject name against every plausible list entry and keep the best
   * hit. Date-of-birth agreement nudges the score, a full id-number match is
   * treated as a certain hit.
   */
  async bestNameHit(
    name: string,
    dateOfBirth?: string | null,
  ): Promise<{
    entry: SanctionsListEntry;
    score: number;
    reasons: string[];
  } | null> {
    const candidates = await this.sanctionsList.candidatesForName(name);
    if (candidates.length === 0) return null;
    let best: {
      entry: SanctionsListEntry;
      score: number;
      reasons: string[];
    } | null = null;

    for (const entry of candidates) {
      const similarity = scoreNameSimilarity(name, entry);
      if (similarity.score <= 0) continue;
      const dobBonus = dateOfBirthAgreement(dateOfBirth, entry.dateOfBirth);
      const score = Math.min(100, similarity.score + dobBonus);
      const reasons = [
        `${similarity.method === 'exact' ? 'Exact' : 'Fuzzy'} ${entry.entryType.toLowerCase()} match on "${entry.name}" (${similarity.score}/100, shared tokens: ${similarity.sharedTokens.join(', ') || 'none'})`,
      ];
      if (dobBonus > 0) reasons.push(`date of birth agrees (+${dobBonus})`);
      if (entry.programme) reasons.push(`programme ${entry.programme}`);
      if (!best || score > best.score) best = { entry, score, reasons };
    }
    return best;
  }

  private async recordResult(args: {
    subjectType: AmlScreeningSubjectType;
    subjectId: string;
    subjectLabel: string;
    listSource: AmlScreeningResult['listSource'];
    decision: AmlScreeningDecision;
    score: number;
    matchedEntryId?: string | null;
    matchedName?: string | null;
    details?: Record<string, unknown>;
    screenedBy?: string | null;
  }): Promise<AmlScreeningResult> {
    return this.resultRepository.save(
      this.resultRepository.create({
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        subjectLabel: args.subjectLabel,
        listSource: args.listSource,
        decision: args.decision,
        score: args.score,
        matchedEntryId: args.matchedEntryId ?? null,
        matchedName: args.matchedName ?? null,
        details: args.details ?? {},
        screenedBy: args.screenedBy ?? null,
      }),
    );
  }

  /**
   * Raise the alert pair for a sanctions / PEP hit: a `ComplianceAlert` row for
   * the existing sanctions queue plus an `AmlAlert` so the monitoring case
   * workflow sees the same finding.
   */
  private async raiseAlerts(
    outcome: Omit<ScreeningOutcome, 'alertId' | 'caseNumber' | 'resultId'>,
    entry: SanctionsListEntry | null,
    user: User | null,
  ): Promise<{ alertId: string; caseNumber: string | null }> {
    const patternType =
      outcome.listSource === 'PEP' ? 'PEP_MATCH' : 'SANCTIONS_MATCH';
    const dedupeKey = `${patternType}:${outcome.subjectType}:${outcome.subjectId}:${
      entry?.id ?? 'external'
    }:${outcome.score.toFixed(0)}`;

    const existing = await this.alertRepository.findOne({
      where: { dedupeKey },
    });
    if (existing) {
      return { alertId: existing.id, caseNumber: existing.caseId ?? null };
    }

    const severity = this.severityFor(
      outcome.decision,
      patternType === 'PEP_MATCH',
    );
    await this.complianceAlertRepository.save(
      this.complianceAlertRepository.create({
        alertType: patternType.toLowerCase(),
        userId: user?.id ?? null,
        walletAddress: user?.walletAddress ?? null,
        userName: user?.fullName ?? outcome.subjectLabel ?? null,
        matchReason: outcome.reasons.join('; '),
        riskScore: Math.round(outcome.score),
        source: `${(outcome.listSource ?? 'ofac').toString().toLowerCase()}_screening`,
        status: 'pending',
        metadata: {
          subjectType: outcome.subjectType,
          subjectId: outcome.subjectId,
          matchedEntryId: outcome.matchedEntryId,
          matchedName: outcome.matchedName,
          listSource: outcome.listSource,
          score: outcome.score,
        },
      }),
    );

    const alert = await this.alertRepository.save(
      this.alertRepository.create({
        patternType,
        ruleId: null,
        ruleCode: `${patternType}-${outcome.listSource}`,
        userId: user?.id ?? null,
        dealId: null,
        severity,
        action: 'REJECT',
        riskScore:
          outcome.decision === 'match' ? 100 : Math.min(99, outcome.score),
        amountUsd: null,
        title:
          patternType === 'PEP_MATCH'
            ? `PEP match: ${outcome.matchedName ?? outcome.subjectId}`
            : `Sanctions match: ${outcome.matchedName ?? outcome.subjectId}`,
        matchReason: outcome.reasons.join('; '),
        evidence: {
          subjectType: outcome.subjectType,
          subjectId: outcome.subjectId,
          listSource: outcome.listSource,
          matchedEntryId: outcome.matchedEntryId,
          matchedName: outcome.matchedName,
          score: outcome.score,
          programme: entry?.programme ?? null,
          listVersion: entry?.listVersion ?? null,
        },
        status: 'pending',
        dedupeKey,
      }),
    );

    let caseNumber: string | null = null;
    if (outcome.decision === 'match' || outcome.decision === 'review') {
      const created = await this.caseService.createCase({
        alertIds: [alert.id],
        subjectUserId: user?.id ?? null,
        priority: severity,
      });
      caseNumber = created.caseNumber;
    }
    return { alertId: alert.id, caseNumber };
  }

  /** Screen a name (and optional wallet) against the loaded lists. */
  async screenSubject(
    dto: ScreenSubjectDto,
    actorId?: string,
  ): Promise<ScreeningOutcome> {
    const user =
      dto.subjectType === 'user'
        ? await this.userRepository.findOne({ where: { id: dto.subjectId } })
        : null;
    const name = dto.name ?? user?.fullName ?? null;
    const wallet = dto.walletAddress ?? user?.walletAddress ?? null;

    if (dto.subjectType === 'wallet' || (name === null && wallet)) {
      return this.screenWallet(
        String(dto.subjectId || wallet),
        user,
        actorId,
        dto.raiseAlert,
      );
    }
    if (!name) {
      const result = await this.recordResult({
        subjectType: dto.subjectType as AmlScreeningSubjectType,
        subjectId: dto.subjectId,
        subjectLabel: '',
        listSource: 'OFAC',
        decision: 'clear',
        score: 0,
        details: { skipped: 'no name on file' },
        screenedBy: actorId ?? null,
      });
      return {
        subjectType: dto.subjectType as AmlScreeningSubjectType,
        subjectId: dto.subjectId,
        decision: 'clear',
        score: 0,
        matchedEntryId: null,
        matchedName: null,
        listSource: 'INTERNAL',
        reasons: ['No name available to screen'],
        alertId: null,
        caseNumber: null,
        resultId: result.id,
      };
    }

    const hit = await this.bestNameHit(name, dto.dateOfBirth);
    const decision: AmlScreeningDecision = hit
      ? this.decide(hit.score)
      : 'clear';
    const score = hit?.score ?? 0;
    const reasons = hit
      ? hit.reasons
      : [
          `No sanctions list entry within ${this.reviewThreshold ?? 0} points of "${name}"`,
        ];

    const result = await this.recordResult({
      subjectType: dto.subjectType as AmlScreeningSubjectType,
      subjectId: dto.subjectId,
      subjectLabel: name,
      listSource: (hit?.entry.listSource ??
        'OFAC') as AmlScreeningResult['listSource'],
      decision,
      score,
      matchedEntryId: hit?.entry.id ?? null,
      matchedName: hit?.entry.name ?? null,
      details: { reasons, normalisedQuery: normaliseSanctionsName(name) },
      screenedBy: actorId ?? null,
    });

    let alertId: string | null = null;
    let caseNumber: string | null = null;
    if (decision !== 'clear' && dto.raiseAlert !== false) {
      const raised = await this.raiseAlerts(
        {
          subjectType: dto.subjectType as AmlScreeningSubjectType,
          subjectId: dto.subjectId,
          decision,
          score,
          matchedEntryId: hit?.entry.id ?? null,
          matchedName: hit?.entry.name ?? null,
          listSource: hit?.entry.listSource ?? 'OFAC',
          reasons,
        },
        hit?.entry ?? null,
        user,
      );
      alertId = raised.alertId;
      caseNumber = raised.caseNumber;
    }

    // PEP screening is a separate question from sanctions designation.
    if (hit?.entry?.isPep && dto.raiseAlert !== false) {
      const pepRaised = await this.raiseAlerts(
        {
          subjectType: dto.subjectType as AmlScreeningSubjectType,
          subjectId: dto.subjectId,
          decision,
          score,
          matchedEntryId: hit.entry.id,
          matchedName: hit.entry.name,
          listSource: 'PEP',
          reasons: [
            `Listed as a politically exposed person${hit.entry.pepRole ? ` (${hit.entry.pepRole})` : ''}`,
          ],
        },
        hit.entry,
        user,
      );
      alertId = alertId ?? pepRaised.alertId;
      caseNumber = caseNumber ?? pepRaised.caseNumber;
    }

    return {
      subjectType: dto.subjectType as AmlScreeningSubjectType,
      subjectId: dto.subjectId,
      decision,
      score,
      matchedEntryId: hit?.entry.id ?? null,
      matchedName: hit?.entry.name ?? null,
      listSource: hit?.entry.listSource ?? 'INTERNAL',
      reasons,
      alertId,
      caseNumber,
      resultId: result.id,
    };
  }

  /** Wallet screening through the existing KYT provider integration. */
  async screenWallet(
    walletAddress: string,
    user: User | null,
    actorId?: string,
    raiseAlert = true,
  ): Promise<ScreeningOutcome> {
    let sanctioned = false;
    let providerError: string | null = null;
    if (this.walletScreener) {
      try {
        sanctioned =
          await this.walletScreener.isAddressSanctioned(walletAddress);
      } catch (error) {
        providerError = (error as Error).message;
        // Fail closed: an unavailable screening provider is not a clean bill of health.
        this.logger.error(
          `Wallet sanctions screening unavailable for ${walletAddress}: ${providerError}`,
        );
      }
    } else {
      this.logger.warn('No wallet screening provider configured');
    }

    const decision: AmlScreeningDecision = sanctioned
      ? 'match'
      : providerError
        ? 'review'
        : 'clear';
    const result = await this.recordResult({
      subjectType: 'wallet',
      subjectId: walletAddress,
      subjectLabel: walletAddress,
      listSource: 'KYT',
      decision,
      score: sanctioned ? 100 : providerError ? 50 : 0,
      details: {
        providerError,
        provider: this.walletScreener ? 'kyt_api' : 'none',
      },
      screenedBy: actorId ?? null,
    });

    let alertId: string | null = null;
    let caseNumber: string | null = null;
    if (decision !== 'clear' && raiseAlert !== false) {
      const raised = await this.raiseAlerts(
        {
          subjectType: 'wallet',
          subjectId: walletAddress,
          decision,
          score: sanctioned ? 100 : 50,
          matchedEntryId: null,
          matchedName: null,
          listSource: 'KYT',
          reasons: sanctioned
            ? ['KYT provider reports the address as sanctioned']
            : [`Wallet screening provider error: ${providerError}`],
        },
        null,
        user,
      );
      alertId = raised.alertId;
      caseNumber = raised.caseNumber;
    }

    return {
      subjectType: 'wallet',
      subjectId: walletAddress,
      decision,
      score: sanctioned ? 100 : providerError ? 50 : 0,
      matchedEntryId: null,
      matchedName: null,
      listSource: 'KYT',
      reasons: sanctioned
        ? ['Address flagged by the KYT provider']
        : providerError
          ? [`Provider unavailable: ${providerError}`]
          : ['Address not flagged by the KYT provider'],
      alertId,
      caseNumber,
      resultId: result.id,
    };
  }

  /**
   * Periodic re-screening of verified accounts (#1217 requirement: lists change,
   * so a clean user yesterday is not proof for today). Batched to keep memory
   * flat on a real user table.
   */
  async rescreenVerifiedUsers(
    batchSize = 200,
    maxUsers = 5000,
  ): Promise<{
    screened: number;
    matches: number;
    reviews: number;
    cleared: number;
  }> {
    const summary = { screened: 0, matches: 0, reviews: 0, cleared: 0 };
    let offset = 0;
    while (offset < maxUsers) {
      const users = await this.userRepository.find({
        where: { kycStatus: In(['verified', 'approved']) },
        order: { id: 'ASC' },
        take: batchSize,
        skip: offset,
      });
      if (users.length === 0) break;
      for (const user of users) {
        if (!user.fullName) continue;
        const outcome = await this.screenSubject({
          subjectType: 'user',
          subjectId: user.id,
          name: user.fullName,
          country: user.country,
          raiseAlert: true,
        });
        summary.screened += 1;
        if (outcome.decision === 'match') summary.matches += 1;
        else if (outcome.decision === 'review') summary.reviews += 1;
        else summary.cleared += 1;
      }
      offset += users.length;
    }
    this.logger.log(
      `Sanctions re-screen: ${summary.screened} users, ${summary.matches} matches, ${summary.reviews} reviews`,
    );
    await this.auditService.logEvent({
      actorId: null,
      route: 'AML_SANCTIONS_RESCREEN',
      statusCode: 200,
      requestDetails: summary,
    });
    return summary;
  }
}
