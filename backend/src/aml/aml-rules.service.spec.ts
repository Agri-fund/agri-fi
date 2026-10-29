import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AmlRulesService } from './aml-rules.service';
import { REQUIRED_PARAMETERS } from './aml-detectors';
import { AmlPatternType, sensitivityFromDisposition } from './aml.constants';
import {
  AmlMonitoringRule,
  AmlRuleParameters,
} from './entities/aml-monitoring-rule.entity';

function createQueryBuilderMock(): any {
  const qb: any = {};
  for (const name of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'groupBy',
    'skip',
    'take',
    'limit',
  ]) {
    qb[name] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getOne = jest.fn().mockResolvedValue(null);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn().mockResolvedValue(null);
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
  return qb;
}

function createRuleRepoMock(): any {
  const qb = createQueryBuilderMock();
  return {
    qb,
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    create: jest.fn((dto: any) => ({ ...dto })),
    save: jest.fn(async (entity: any) => ({ ...entity })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(() => qb),
  };
}

function makeRule(
  overrides: Partial<AmlMonitoringRule> = {},
): AmlMonitoringRule {
  const rule = new AmlMonitoringRule();
  rule.id = 'rule-1';
  rule.ruleCode = 'AML-MON-TEST-001';
  rule.name = 'Test rule';
  rule.description = '';
  rule.patternType = 'VELOCITY';
  rule.riskLevel = 'MEDIUM';
  rule.action = 'FLAG_REVIEW';
  rule.enabled = true;
  rule.jurisdiction = 'GLOBAL';
  rule.windowHours = 24;
  rule.parameters = { maxFlowsPerWindow: 12 };
  rule.baseRiskScore = 50;
  rule.alertThresholdScore = 40;
  rule.sensitivityMultiplier = 1;
  rule.falsePositiveCount = 0;
  rule.truePositiveCount = 0;
  rule.version = 1;
  rule.createdBy = null;
  return Object.assign(rule, overrides);
}

function parametersFor(keys: string[]): AmlRuleParameters {
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    values[key] = key === 'countries' ? ['RU'] : 1;
  }
  return values as AmlRuleParameters;
}

function withoutKey(keys: string[], missing: string): AmlRuleParameters {
  const values: Record<string, unknown> = { ...parametersFor(keys) };
  delete values[missing];
  return values as AmlRuleParameters;
}

describe('AmlRulesService', () => {
  let ruleRepo: any;
  let service: AmlRulesService;
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    ruleRepo = createRuleRepoMock();
    service = new AmlRulesService(ruleRepo);
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    (service as any).logger = logger;
  });

  describe('ensureDefaults', () => {
    const shippedCodes = AmlRulesService.DEFAULT_RULES.map(
      (preset) => preset.ruleCode as string,
    );

    it('inserts the seven shipped rules when none exist', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      const result = await service.ensureDefaults();

      expect(shippedCodes).toHaveLength(7);
      expect(result.created).toEqual(shippedCodes);
      expect(ruleRepo.create).toHaveBeenCalledTimes(7);
      expect(ruleRepo.save).toHaveBeenCalledTimes(7);
      expect(logger.log).toHaveBeenCalledWith('Seeded 7 AML monitoring rules');
    });

    it('stamps seeded rules with the safe defaults and the actor', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await service.ensureDefaults('admin-1');

      const seeded = ruleRepo.save.mock.calls.map((call) => call[0]);
      for (const rule of seeded) {
        expect(rule.enabled).toBe(true);
        expect(rule.jurisdiction).toBe('GLOBAL');
        expect(rule.version).toBe(1);
        expect(rule.createdBy).toBe('admin-1');
        expect(rule.alertThresholdScore).toBeGreaterThan(0);
      }
    });

    it('records a null author when no actor is supplied', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await service.ensureDefaults();

      expect(ruleRepo.create.mock.calls[0][0].createdBy).toBeNull();
    });

    it('is idempotent: a second call creates nothing', async () => {
      ruleRepo.findOne.mockImplementation(async () => makeRule());

      const first = await service.ensureDefaults();
      const second = await service.ensureDefaults();

      expect(first.created).toEqual([]);
      expect(second.created).toEqual([]);
      expect(ruleRepo.create).not.toHaveBeenCalled();
      expect(ruleRepo.save).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('only seeds patterns that have no rule yet', async () => {
      ruleRepo.findOne.mockImplementation(
        async (options: { where: { ruleCode: string } }) =>
          options.where.ruleCode === 'AML-MON-VELO-001'
            ? makeRule({ ruleCode: 'AML-MON-VELO-001' })
            : null,
      );

      const result = await service.ensureDefaults();

      expect(result.created).toHaveLength(6);
      expect(result.created).not.toContain('AML-MON-VELO-001');
      expect(ruleRepo.save).toHaveBeenCalledTimes(6);
    });

    it('looks each preset up by its rule code', async () => {
      ruleRepo.findOne.mockResolvedValue(makeRule());

      await service.ensureDefaults();

      expect(ruleRepo.findOne).toHaveBeenCalledWith({
        where: { ruleCode: shippedCodes[0] },
      });
    });
  });

  describe('validateParameters', () => {
    const requiredByPattern: Array<[AmlPatternType, string[]]> = Object.entries(
      REQUIRED_PARAMETERS,
    ) as Array<[AmlPatternType, string[]]>;

    for (const [patternType, keys] of requiredByPattern) {
      it(`rejects ${patternType} when a required parameter is missing`, () => {
        expect(() => service.validateParameters(patternType, {})).toThrow(
          BadRequestException,
        );

        for (const key of keys) {
          expect(() =>
            service.validateParameters(patternType, withoutKey(keys, key)),
          ).toThrow(`Rule pattern ${patternType} requires parameter "${key}"`);
        }
      });

      it(`accepts a complete ${patternType} parameter set`, () => {
        expect(() =>
          service.validateParameters(patternType, parametersFor(keys)),
        ).not.toThrow();
      });
    }

    it('skips validation for patterns with no parameters', () => {
      expect(() => service.validateParameters('SANCTIONS_MATCH')).not.toThrow();
      expect(() =>
        service.validateParameters('PEP_MATCH', undefined),
      ).not.toThrow();
    });

    it('treats a missing parameter object as empty', () => {
      expect(() => service.validateParameters('VELOCITY')).toThrow(
        BadRequestException,
      );
    });

    it('rejects null and empty-string parameter values', () => {
      expect(() =>
        service.validateParameters('HIGH_VALUE', {
          amountThresholdUsd: null,
        } as unknown as AmlRuleParameters),
      ).toThrow(
        'Rule pattern HIGH_VALUE requires parameter "amountThresholdUsd"',
      );

      expect(() =>
        service.validateParameters('HIGH_RISK_JURISDICTION', {
          countries: '',
        } as unknown as AmlRuleParameters),
      ).toThrow(
        'Rule pattern HIGH_RISK_JURISDICTION requires parameter "countries"',
      );
    });

    it('allows an explicit empty watchlist', () => {
      expect(() =>
        service.validateParameters('HIGH_RISK_JURISDICTION', {
          countries: [],
        }),
      ).not.toThrow();
    });

    it('rejects non-positive and non-finite numbers', () => {
      for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          service.validateParameters('VELOCITY', { maxFlowsPerWindow: bad }),
        ).toThrow(
          'Rule parameter "maxFlowsPerWindow" must be a positive number for VELOCITY',
        );
      }
    });

    it('keeps movementRatio inside the 0-1 fraction range', () => {
      expect(() =>
        service.validateParameters('RAPID_MOVEMENT', {
          movementRatio: 1.4,
          minInflowUsd: 1000,
        }),
      ).toThrow('movementRatio is a fraction of inflow and must be <= 1');

      expect(() =>
        service.validateParameters('RAPID_MOVEMENT', {
          movementRatio: 1,
          minInflowUsd: 1000,
        }),
      ).not.toThrow();
    });
  });

  describe('createRule', () => {
    it('upper-cases and trims the rule code', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await service.createRule(
        {
          ruleCode: '  aml-mon-custom-002 ',
          name: 'Custom rule',
          patternType: 'VELOCITY',
          parameters: { maxFlowsPerWindow: 8 },
        },
        'admin-1',
      );

      expect(ruleRepo.findOne).toHaveBeenCalledWith({
        where: { ruleCode: 'AML-MON-CUSTOM-002' },
      });
      expect(ruleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleCode: 'AML-MON-CUSTOM-002',
          createdBy: 'admin-1',
        }),
      );
    });

    it('validates the parameters before anything is persisted', async () => {
      const spy = jest.spyOn(service, 'validateParameters');

      await service.createRule({
        ruleCode: 'AML-MON-CUSTOM-003',
        name: 'Custom rule',
        patternType: 'VELOCITY',
        parameters: { maxFlowsPerWindow: 8 },
      });

      expect(spy).toHaveBeenCalledWith('VELOCITY', { maxFlowsPerWindow: 8 });
    });

    it('rejects a duplicate rule code', async () => {
      ruleRepo.findOne.mockResolvedValue(makeRule({ ruleCode: 'AML-DUP-001' }));

      await expect(
        service.createRule({
          ruleCode: 'aml-dup-001',
          name: 'Duplicate',
          patternType: 'VELOCITY',
          parameters: { maxFlowsPerWindow: 8 },
        }),
      ).rejects.toThrow(BadRequestException);

      expect(ruleRepo.create).not.toHaveBeenCalled();
      expect(ruleRepo.save).not.toHaveBeenCalled();
    });

    it('propagates the parameter validation failure', async () => {
      const spy = jest
        .spyOn(service, 'validateParameters')
        .mockImplementation(() => {
          throw new BadRequestException('invalid parameters');
        });

      await expect(
        service.createRule({
          ruleCode: 'AML-MON-CUSTOM-004',
          name: 'Custom rule',
          patternType: 'STRUCTURING',
        }),
      ).rejects.toThrow('invalid parameters');

      expect(spy).toHaveBeenCalled();
      expect(ruleRepo.findOne).not.toHaveBeenCalled();
    });

    it('applies entity defaults when the dto omits optional fields', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await service.createRule({
        ruleCode: 'AML-MON-SANC-001',
        name: 'Sanctions match',
        patternType: 'SANCTIONS_MATCH',
      });

      expect(ruleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: '',
          riskLevel: 'MEDIUM',
          action: 'FLAG_REVIEW',
          enabled: true,
          jurisdiction: 'GLOBAL',
          windowHours: 24,
          parameters: {},
          baseRiskScore: 50,
          alertThresholdScore: 40,
          sensitivityMultiplier: 1,
          version: 1,
          createdBy: null,
        }),
      );
    });

    it('honours the optional fields the caller does supply', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await service.createRule({
        ruleCode: 'AML-MON-HV-002',
        name: 'High value',
        patternType: 'HIGH_VALUE',
        parameters: { amountThresholdUsd: 25000 },
        riskLevel: 'CRITICAL',
        action: 'REJECT',
        enabled: false,
        jurisdiction: 'NG',
        windowHours: 48,
        baseRiskScore: 90,
        alertThresholdScore: 60,
        description: 'Custom ceiling',
      });

      expect(ruleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          riskLevel: 'CRITICAL',
          action: 'REJECT',
          enabled: false,
          jurisdiction: 'NG',
          windowHours: 48,
          baseRiskScore: 90,
          alertThresholdScore: 60,
          description: 'Custom ceiling',
        }),
      );
    });

    it('returns the persisted rule', async () => {
      ruleRepo.findOne.mockResolvedValue(null);
      const persisted = makeRule({ id: 'rule-new' });
      ruleRepo.save.mockResolvedValue(persisted);

      const result = await service.createRule({
        ruleCode: 'AML-MON-CUSTOM-005',
        name: 'Custom rule',
        patternType: 'VELOCITY',
        parameters: { maxFlowsPerWindow: 8 },
      });

      expect(result).toBe(persisted);
      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ ruleCode: 'AML-MON-CUSTOM-005' }),
      );
    });
  });

  describe('updateRule', () => {
    it('bumps the version only when the parameters changed', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRule({ version: 3, parameters: { maxFlowsPerWindow: 12 } }),
      );

      await service.updateRule('rule-1', {
        parameters: { maxFlowsPerWindow: 20 },
      });

      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ version: 4 }),
      );
    });

    it('keeps the version when the parameters are equivalent', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRule({ version: 3, parameters: { maxFlowsPerWindow: 12 } }),
      );

      await service.updateRule('rule-1', {
        parameters: { maxFlowsPerWindow: 12 },
      });

      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ version: 3 }),
      );
    });

    it('keeps the version when no parameters are sent', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRule({ version: 2, parameters: { maxFlowsPerWindow: 12 } }),
      );

      await service.updateRule('rule-1', { name: 'Renamed rule' });

      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 2,
          name: 'Renamed rule',
          parameters: { maxFlowsPerWindow: 12 },
        }),
      );
    });

    it('upper-cases a supplied rule code and keeps the stored one otherwise', async () => {
      ruleRepo.findOne.mockImplementation(async () =>
        makeRule({ ruleCode: 'AML-MON-KEEP-001' }),
      );

      await service.updateRule('rule-1', { ruleCode: ' aml-mon-renamed-001 ' });

      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ ruleCode: 'AML-MON-RENAMED-001' }),
      );

      await service.updateRule('rule-1', { enabled: false });

      expect(ruleRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ ruleCode: 'AML-MON-KEEP-001' }),
      );
    });

    it('validates against the incoming pattern type and merged parameters', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRule({ patternType: 'VELOCITY', parameters: {} }),
      );
      const spy = jest.spyOn(service, 'validateParameters');

      await service.updateRule('rule-1', {
        patternType: 'HIGH_VALUE',
        parameters: { amountThresholdUsd: 50000 },
      });

      expect(spy).toHaveBeenCalledWith('HIGH_VALUE', {
        amountThresholdUsd: 50000,
      });
    });

    it('falls back to the stored pattern type for validation', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRule({ patternType: 'STRUCTURING', parameters: {} }),
      );

      await expect(
        service.updateRule('rule-1', { name: 'No params' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when the rule does not exist', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await expect(service.updateRule('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getRule and listRules', () => {
    it('returns the stored rule', async () => {
      const rule = makeRule();
      ruleRepo.findOne.mockResolvedValue(rule);

      await expect(service.getRule('rule-1')).resolves.toBe(rule);
    });

    it('throws NotFoundException for an unknown rule', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await expect(service.getRule('nope')).rejects.toThrow(NotFoundException);
    });

    it('lists every rule ordered by risk level', async () => {
      ruleRepo.find.mockResolvedValue([makeRule()]);

      const rules = await service.listRules();

      expect(rules).toHaveLength(1);
      expect(ruleRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { riskLevel: 'DESC', ruleCode: 'ASC' },
      });
    });

    it('can restrict the listing to enabled rules', async () => {
      ruleRepo.find.mockResolvedValue([]);

      await service.listRules(true);

      expect(ruleRepo.find).toHaveBeenCalledWith({
        where: { enabled: true },
        order: { riskLevel: 'DESC', ruleCode: 'ASC' },
      });
    });
  });

  describe('activeFlowRules', () => {
    it('drops the screening-driven patterns', async () => {
      ruleRepo.find.mockResolvedValue([
        makeRule({ ruleCode: 'A', patternType: 'STRUCTURING' }),
        makeRule({ ruleCode: 'B', patternType: 'SANCTIONS_MATCH' }),
        makeRule({ ruleCode: 'C', patternType: 'PEP_MATCH' }),
        makeRule({ ruleCode: 'D', patternType: 'VELOCITY' }),
      ]);

      const rules = await service.activeFlowRules();

      expect(rules.map((rule) => rule.ruleCode)).toEqual(['A', 'D']);
      expect(ruleRepo.find).toHaveBeenCalledWith({ where: { enabled: true } });
    });

    it('returns an empty list when nothing is enabled', async () => {
      ruleRepo.find.mockResolvedValue([]);

      await expect(service.activeFlowRules()).resolves.toEqual([]);
    });
  });

  describe('setEnabled', () => {
    it('flips the flag and persists the rule', async () => {
      const rule = makeRule({ enabled: true });
      ruleRepo.findOne.mockResolvedValue(rule);

      const result = await service.setEnabled('rule-1', false);

      expect(rule.enabled).toBe(false);
      expect(result.enabled).toBe(false);
      expect(ruleRepo.save).toHaveBeenCalledWith(rule);
    });

    it('throws for an unknown rule', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await expect(service.setEnabled('nope', true)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recalculateSensitivity', () => {
    it('writes the multiplier derived from the disposition history', async () => {
      const rule = makeRule({
        falsePositiveCount: 11,
        truePositiveCount: 0,
        sensitivityMultiplier: 1,
      });
      ruleRepo.findOne.mockResolvedValue(rule);

      const result = await service.recalculateSensitivity('rule-1');

      expect(result.sensitivityMultiplier).toBe(
        sensitivityFromDisposition(11, 0),
      );
      expect(result.sensitivityMultiplier).toBe(0.4);
      expect(result.falsePositiveCount).toBe(11);
      expect(result.truePositiveCount).toBe(0);
      expect(rule.sensitivityMultiplier).toBe(0.4);
      expect(ruleRepo.save).toHaveBeenCalledWith(rule);
    });

    it('does not write when the multiplier is already correct', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRule({
          falsePositiveCount: 4,
          truePositiveCount: 1,
          sensitivityMultiplier: sensitivityFromDisposition(4, 1),
        }),
      );

      const result = await service.recalculateSensitivity('rule-1');

      expect(result.sensitivityMultiplier).toBe(0.6);
      expect(ruleRepo.save).not.toHaveBeenCalled();
    });

    it('defaults missing counters to zero', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRule({
          falsePositiveCount: null as unknown as number,
          truePositiveCount: undefined as unknown as number,
          sensitivityMultiplier: 1,
        }),
      );

      const result = await service.recalculateSensitivity('rule-1');

      expect(result).toEqual({
        sensitivityMultiplier: 1,
        falsePositiveCount: 0,
        truePositiveCount: 0,
      });
      expect(ruleRepo.save).not.toHaveBeenCalled();
    });

    it('reads counters from the stored rule', async () => {
      ruleRepo.findOne.mockResolvedValue(
        makeRule({
          falsePositiveCount: 1,
          truePositiveCount: 4,
          sensitivityMultiplier: 1,
        }),
      );

      const result = await service.recalculateSensitivity('rule-1');

      expect(result.sensitivityMultiplier).toBe(1.25);
    });

    it('throws for an unknown rule', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await expect(service.recalculateSensitivity('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
