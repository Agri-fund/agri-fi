import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemAuditLog } from './entities/system-audit-log.entity';

export type FederatedLearningAuditEventType =
  | 'participant_onboarding'
  | 'round_completion'
  | 'contribution'
  | 'reward'
  | 'poisoning_rejection';

export interface FederatedLearningAuditEvent {
  eventType: FederatedLearningAuditEventType;
  participantId?: string;
  roundId?: string;
  details?: Record<string, any>;
  actorId?: string;
  ipAddress?: string;
}

export interface AuditQuery {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: string;
  endDate?: string;
  page?: string;
  limit?: string;
}

export interface QuantumResistanceAuditResult {
  compliant: boolean;
  totalSensitiveRecords: number;
  nonCompliantRecordIds: string[];
  checkedAt: Date;
}

export const QUANTUM_RESISTANT_ALGORITHMS = [
  'ML-KEM-768+X25519',
  'ML-DSA-65',
] as const;

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new BadRequestException(`Expected an integer from 1 to ${max}.`);
  }
  return Number(value);
}

function auditDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid audit date.');
  return date;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(SystemAuditLog)
    private readonly auditRepository: Repository<SystemAuditLog>,
  ) {}

  async logEvent(
    entry: Partial<SystemAuditLog>,
  ): Promise<SystemAuditLog | null> {
    try {
      const auditLog = this.auditRepository.create(entry);
      return await this.auditRepository.save(auditLog);
    } catch (err: any) {
      this.logger.error(
        `Failed to persist system audit log: ${err?.message || err}`,
        err?.stack,
      );
      return null;
    }
  }

  async findAll(
    query: AuditQuery = {},
    complianceDomain?: string,
  ): Promise<{ data: SystemAuditLog[]; total: number; page: number; limit: number }> {
    const page = positiveInteger(query.page, 1, 1_000_000);
    const limit = positiveInteger(query.limit, 100, 500);
    const start = auditDate(query.startDate);
    const end = auditDate(query.endDate);
    if (start && end && start > end) {
      throw new BadRequestException('startDate must be before endDate.');
    }
    const qb = this.auditRepository.createQueryBuilder('audit');
    if (query.actorId) qb.andWhere('audit.actorId = :actorId', { actorId: query.actorId });
    if (query.action) qb.andWhere('audit.action = :action', { action: query.action });
    if (query.resourceType) qb.andWhere('audit.resourceType = :resourceType', { resourceType: query.resourceType });
    if (query.resourceId) qb.andWhere('audit.resourceId = :resourceId', { resourceId: query.resourceId });
    if (start) qb.andWhere('audit.createdAt >= :start', { start });
    if (end) qb.andWhere('audit.createdAt <= :end', { end });
    if (complianceDomain) qb.andWhere('audit.complianceDomain = :complianceDomain', { complianceDomain });
    const [data, total] = await qb
      .orderBy('audit.createdAt', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { data, total, page, limit };
  }

  /**
   * Log a federated learning participation event so network activity
   * (onboarding, round completion, contributions, rewards, poisoning
   * rejections) is traceable through the system audit log.
   */
  async logFederatedLearningEvent(
    event: FederatedLearningAuditEvent,
  ): Promise<SystemAuditLog | null> {
    const { eventType, participantId, roundId, details, actorId, ipAddress } =
      event;

    const entry: Partial<SystemAuditLog> = {
      action: `federated_learning.${eventType}`,
      actorId,
      ipAddress,
      metadata: {
        eventType,
        participantId,
        roundId,
        ...(details || {}),
      },
    } as Partial<SystemAuditLog>;

    return this.logEvent(entry);
  }

  async logParticipantOnboarding(
    participantId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'participant_onboarding',
      participantId,
      details,
    });
  }

  async logRoundCompletion(
    roundId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'round_completion',
      roundId,
      details,
    });
  }

  async logContribution(
    participantId: string,
    roundId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'contribution',
      participantId,
      roundId,
      details,
    });
  }

  async logReward(
    participantId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'reward',
      participantId,
      details,
    });
  }

  async logPoisoningRejection(
    participantId: string,
    roundId: string,
    details?: Record<string, any>,
  ): Promise<SystemAuditLog | null> {
    return this.logFederatedLearningEvent({
      eventType: 'poisoning_rejection',
      participantId,
      roundId,
      details,
    });
  }

  /**
   * Record the algorithm suite used to protect a sensitive resource so that
   * quantum-resistance coverage can be verified later.
   */
  async logCryptoSuite(
    resourceType: string,
    resourceId: string,
    suite: string,
    actorId?: string,
  ): Promise<SystemAuditLog | null> {
    return this.logEvent({
      action: 'crypto.suite_applied',
      actorId,
      resourceType,
      resourceId,
      metadata: { suite, quantumResistant: this.isQuantumResistantSuite(suite) },
    } as Partial<SystemAuditLog>);
  }

  isQuantumResistantSuite(suite: string): boolean {
    return (QUANTUM_RESISTANT_ALGORITHMS as readonly string[]).some((alg) =>
      suite.includes(alg),
    );
  }

  /**
   * Verify that every sensitive audit record was protected with a
   * quantum-resistant suite. Records lacking a recorded suite are reported
   * as non-compliant.
   */
  async verifyQuantumResistance(
    resourceType?: string,
  ): Promise<QuantumResistanceAuditResult> {
    const qb = this.auditRepository
      .createQueryBuilder('audit')
      .where('audit.complianceDomain IS NOT NULL');
    if (resourceType) {
      qb.andWhere('audit.resourceType = :resourceType', { resourceType });
    }
    const records = await qb.getMany();
    const nonCompliantRecordIds = records
      .filter((r) => {
        const suite = (r.metadata as any)?.suite;
        return typeof suite !== 'string' || !this.isQuantumResistantSuite(suite);
      })
      .map((r) => String(r.id));
    return {
      compliant: nonCompliantRecordIds.length === 0,
      totalSensitiveRecords: records.length,
      nonCompliantRecordIds,
      checkedAt: new Date(),
    };
  }
}
