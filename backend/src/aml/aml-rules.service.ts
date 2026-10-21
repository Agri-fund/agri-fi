import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AmlMonitoringRule,
  AmlRuleParameters,
} from './entities/aml-monitoring-rule.entity';
import { CreateAmlRuleDto, UpdateAmlRuleDto } from './dto/aml-monitoring.dto';
import { AmlPatternType, sensitivityFromDisposition } from './aml.constants';
import { REQUIRED_PARAMETERS } from './aml-detectors';

/**
 * Tunable rules used by the monitoring sweep (#1217). This is intentionally a
 * separate rule store from `RegulatoryRule`: those screen one fact set against
 * static conditions, these drive time-windowed detectors over a user's money
 * movements. Both are consulted during a sweep.
 */
@Injectable()
export class AmlRulesService {
  private readonly logger = new Logger(AmlRulesService.name);

  constructor(
    @InjectRepository(AmlMonitoringRule)
    private readonly ruleRepository: Repository<AmlMonitoringRule>,
  ) {}

  /** Rules shipped with the feature so monitoring is live without manual setup. */
  static readonly DEFAULT_RULES: Array<Partial<AmlMonitoringRule>> = [
    {
      ruleCode: 'AML-MON-STRUCT-001',
      name: 'Sub-threshold deposit clustering',
      description:
        'Several inflows each below the currency transaction report threshold that together reach it inside one day.',
      patternType: 'STRUCTURING',
      riskLevel: 'HIGH',
      action: 'FLAG_REVIEW',
      windowHours: 24,
      baseRiskScore: 70,
      alertThresholdScore: 45,
      parameters: {
        maxIndividualAmountUsd: 9500,
        aggregateThresholdUsd: 10000,
        minFlowCount: 3,
      },
    },
    {
      ruleCode: 'AML-MON-RAPID-001',
      name: 'Same-window pass-through',
      description:
        'Funds that arrive and leave again inside two days at near full value, a funnel-account indicator.',
      patternType: 'RAPID_MOVEMENT',
      riskLevel: 'HIGH',
      action: 'FLAG_REVIEW',
      windowHours: 48,
      baseRiskScore: 65,
      alertThresholdScore: 40,
      parameters: { movementRatio: 0.9, minInflowUsd: 1000 },
    },
    {
      ruleCode: 'AML-MON-LAYER-001',
      name: 'Multi-deal layering',
      description:
        'In and out movements interleaved across several distinct deals inside a week.',
      patternType: 'LAYERING',
      riskLevel: 'CRITICAL',
      action: 'REQUIRE_ENHANCED_DUE_DILIGENCE',
      windowHours: 24 * 7,
      baseRiskScore: 80,
      alertThresholdScore: 50,
      parameters: { minDistinctDeals: 3, minFlowCount: 4 },
    },
    {
      ruleCode: 'AML-MON-VELO-001',
      name: 'Movement velocity',
      description:
        'More movements in a day than the account normally performs.',
      patternType: 'VELOCITY',
      riskLevel: 'MEDIUM',
      action: 'FLAG_REVIEW',
      windowHours: 24,
      baseRiskScore: 50,
      alertThresholdScore: 35,
      parameters: { maxFlowsPerWindow: 12 },
    },
    {
      ruleCode: 'AML-MON-HV-001',
      name: 'Single high-value movement',
      description:
        'One movement at or above the enhanced due diligence ceiling.',
      patternType: 'HIGH_VALUE',
      riskLevel: 'MEDIUM',
      action: 'FLAG_REVIEW',
      windowHours: 24,
      baseRiskScore: 55,
      alertThresholdScore: 40,
      parameters: { amountThresholdUsd: 50000 },
    },
    {
      ruleCode: 'AML-MON-JURIS-001',
      name: 'High-risk jurisdiction exposure',
      description:
        'Account or deal counterparty located in a jurisdiction flagged for enhanced monitoring.',
      patternType: 'HIGH_RISK_JURISDICTION',
      riskLevel: 'HIGH',
      action: 'REQUIRE_ENHANCED_DUE_DILIGENCE',
      windowHours: 24 * 30,
      baseRiskScore: 60,
      alertThresholdScore: 40,
      // Placeholder list; real deployments load their own watchlist.
      parameters: { countries: [] },
    },
    {
      ruleCode: 'AML-MON-BEHAV-001',
      name: 'Behavioural anomaly',
      description:
        'Amount or cadence far outside the account owner behaviour baseline.',
      patternType: 'BEHAVIORAL_ANOMALY',
      riskLevel: 'MEDIUM',
      action: 'FLAG_REVIEW',
      windowHours: 24 * 30,
      baseRiskScore: 45,
      alertThresholdScore: 30,
      parameters: { zScoreThreshold: 3, minHistorySamples: 5 },
    },
  ];

  /** Insert the shipped rule set for any pattern that has no rule yet. */
  async ensureDefaults(actorId?: string): Promise<{ created: string[] }> {
    const created: string[] = [];
    for (const preset of AmlRulesService.DEFAULT_RULES) {
      const existing = await this.ruleRepository.findOne({
        where: { ruleCode: preset.ruleCode as string },
      });
      if (existing) continue;
      const rule = this.ruleRepository.create({
        ...preset,
        enabled: true,
        jurisdiction: 'GLOBAL',
        version: 1,
        createdBy: actorId ?? null,
      } as Partial<AmlMonitoringRule>);
      await this.ruleRepository.save(rule);
      created.push(rule.ruleCode);
    }
    if (created.length) {
      this.logger.log(`Seeded ${created.length} AML monitoring rules`);
    }
    return { created };
  }

  validateParameters(
    patternType: AmlPatternType,
    parameters?: AmlRuleParameters,
  ): void {
    const required = REQUIRED_PARAMETERS[patternType];
    if (!required) return;
    const values = parameters ?? {};
    for (const key of required) {
      const value = (values as Record<string, unknown>)[key];
      if (value === undefined || value === null || value === '') {
        throw new BadRequestException(
          `Rule pattern ${patternType} requires parameter "${key}"`,
        );
      }
      if (key === 'countries' && Array.isArray(value) && value.length === 0) {
        // An empty watchlist is allowed (nothing to match) but must be explicit.
        continue;
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
          throw new BadRequestException(
            `Rule parameter "${key}" must be a positive number for ${patternType}`,
          );
        }
        if (key === 'movementRatio' && value > 1) {
          throw new BadRequestException(
            'movementRatio is a fraction of inflow and must be <= 1',
          );
        }
      }
    }
  }

  async createRule(
    dto: CreateAmlRuleDto,
    actorId?: string,
  ): Promise<AmlMonitoringRule> {
    this.validateParameters(
      dto.patternType,
      dto.parameters as AmlRuleParameters,
    );
    const existing = await this.ruleRepository.findOne({
      where: { ruleCode: dto.ruleCode.trim().toUpperCase() },
    });
    if (existing) {
      throw new BadRequestException(`Rule ${dto.ruleCode} already exists`);
    }
    const rule = this.ruleRepository.create({
      ruleCode: dto.ruleCode.trim().toUpperCase(),
      name: dto.name,
      description: dto.description ?? '',
      patternType: dto.patternType,
      riskLevel: dto.riskLevel ?? 'MEDIUM',
      action: dto.action ?? 'FLAG_REVIEW',
      enabled: dto.enabled ?? true,
      jurisdiction: dto.jurisdiction ?? 'GLOBAL',
      windowHours: dto.windowHours ?? 24,
      parameters: (dto.parameters ?? {}) as AmlRuleParameters,
      baseRiskScore: dto.baseRiskScore ?? 50,
      alertThresholdScore: dto.alertThresholdScore ?? 40,
      sensitivityMultiplier: 1,
      version: 1,
      createdBy: actorId ?? null,
    });
    return this.ruleRepository.save(rule);
  }

  async updateRule(
    id: string,
    dto: UpdateAmlRuleDto,
  ): Promise<AmlMonitoringRule> {
    const rule = await this.getRule(id);
    const nextParameters = (dto.parameters ??
      rule.parameters) as AmlRuleParameters;
    this.validateParameters(
      dto.patternType ?? rule.patternType,
      nextParameters,
    );

    const changed =
      dto.parameters !== undefined &&
      JSON.stringify(dto.parameters) !== JSON.stringify(rule.parameters);

    Object.assign(rule, {
      ...dto,
      ruleCode: dto.ruleCode
        ? dto.ruleCode.trim().toUpperCase()
        : rule.ruleCode,
      parameters: nextParameters,
      version: changed ? rule.version + 1 : rule.version,
    });
    return this.ruleRepository.save(rule);
  }

  async getRule(id: string): Promise<AmlMonitoringRule> {
    const rule = await this.ruleRepository.findOne({ where: { id } });
    if (!rule) throw new NotFoundException(`AML rule ${id} not found`);
    return rule;
  }

  async listRules(enabledOnly = false): Promise<AmlMonitoringRule[]> {
    return this.ruleRepository.find({
      where: enabledOnly ? { enabled: true } : {},
      order: { riskLevel: 'DESC', ruleCode: 'ASC' },
    });
  }

  /**
   * Enabled rules the sweep can run. Sanctions/PEP patterns are produced by the
   * screening pipeline rather than the flow detectors, so they are excluded here
   * to stop the sweep double-counting the same finding.
   */
  async activeFlowRules(): Promise<AmlMonitoringRule[]> {
    const rules = await this.ruleRepository.find({ where: { enabled: true } });
    return rules.filter(
      (rule) =>
        rule.patternType !== 'SANCTIONS_MATCH' &&
        rule.patternType !== 'PEP_MATCH',
    );
  }

  async setEnabled(id: string, enabled: boolean): Promise<AmlMonitoringRule> {
    const rule = await this.getRule(id);
    rule.enabled = enabled;
    return this.ruleRepository.save(rule);
  }

  /** Recompute a rule's sensitivity from its disposition history. */
  async recalculateSensitivity(ruleId: string): Promise<{
    sensitivityMultiplier: number;
    falsePositiveCount: number;
    truePositiveCount: number;
  }> {
    const rule = await this.getRule(ruleId);
    const multiplier = sensitivityFromDisposition(
      Number(rule.falsePositiveCount ?? 0),
      Number(rule.truePositiveCount ?? 0),
    );
    if (multiplier !== Number(rule.sensitivityMultiplier)) {
      rule.sensitivityMultiplier = multiplier;
      await this.ruleRepository.save(rule);
    }
    return {
      sensitivityMultiplier: multiplier,
      falsePositiveCount: Number(rule.falsePositiveCount ?? 0),
      truePositiveCount: Number(rule.truePositiveCount ?? 0),
    };
  }
}
