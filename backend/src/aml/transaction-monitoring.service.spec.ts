import { CashFlow, PatternMatch } from './aml.constants';
import { AmlMonitoringRule } from './entities/aml-monitoring-rule.entity';
import { TransactionMonitoringService } from './transaction-monitoring.service';

const HOUR_MS = 3_600_000;
const WINDOW_START = new Date('2026-10-01T00:00:00.000Z');
const WINDOW_END = new Date('2026-10-01T12:00:00.000Z');
const IN_WINDOW_AT = new Date('2026-10-01T06:00:00.000Z');

/** Chainable query-builder mock ending in the terminal methods the service uses. */
function makeQb(raw: unknown[] = []): any {
  const qb: any = {
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    leftJoin: jest.fn(() => qb),
    innerJoin: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    getRawMany: jest.fn(async () => raw),
    getMany: jest.fn(async () => []),
    getOne: jest.fn(async () => null),
    getCount: jest.fn(async () => 0),
    execute: jest.fn(async () => undefined),
  };
  return qb;
}

function makeRepo(raw: unknown[] = []): any {
  const qb = makeQb(raw);
  return {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    findAndCount: jest.fn(async () => [[], 0]),
    create: jest.fn((payload: any) => ({ ...payload })),
    save: jest.fn(async (entity: any) => entity),
    update: jest.fn(async () => ({ affected: 1 })),
    count: jest.fn(async () => 0),
    delete: jest.fn(async () => ({ affected: 0 })),
    createQueryBuilder: jest.fn(() => qb),
    qb,
  };
}

function makeFlow(overrides: Partial<CashFlow> = {}): CashFlow {
  return {
    id: 'flow-1',
    userId: 'user-1',
    direction: 'in',
    amountUsd: 1000,
    at: IN_WINDOW_AT,
    dealId: 'deal-1',
    source: 'investments',
    counterpartyCountry: 'NG',
    commodity: 'Cocoa',
    ...overrides,
  };
}

function makeMatch(overrides: Partial<PatternMatch> = {}): PatternMatch {
  return {
    patternType: 'HIGH_VALUE',
    ruleId: 'rule-hv',
    ruleCode: 'HV-1',
    severity: 'HIGH',
    action: 'FLAG_REVIEW',
    baseRiskScore: 80,
    riskScore: 80,
    title: 'High value movement',
    reason: 'A single inflow met the threshold.',
    dedupeKey: 'HV-1:high-value:flow-1',
    evidence: { note: 'evidence' },
    amountUsd: 1000,
    flowIds: ['flow-1'],
    ...overrides,
  };
}

function makeRule(
  overrides: Partial<AmlMonitoringRule> = {},
): AmlMonitoringRule {
  return {
    id: 'rule-hv',
    ruleCode: 'HV-1',
    name: 'High value movement',
    description: '',
    patternType: 'HIGH_VALUE',
    riskLevel: 'HIGH',
    action: 'FLAG_REVIEW',
    enabled: true,
    jurisdiction: 'GLOBAL',
    windowHours: 24,
    parameters: { amountThresholdUsd: 1000 },
    baseRiskScore: 80,
    alertThresholdScore: 40,
    sensitivityMultiplier: 1,
    falsePositiveCount: 0,
    truePositiveCount: 0,
    version: 1,
    createdBy: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as AmlMonitoringRule;
}

describe('TransactionMonitoringService', () => {
  let investmentRepo: any;
  let distributionRepo: any;
  let logRepo: any;
  let userRepo: any;
  let alertRepo: any;
  let runRepo: any;
  let rulesService: any;
  let caseService: any;
  let ruleEngine: any;
  let auditService: any;
  let config: any;
  let logger: any;
  let service: TransactionMonitoringService;

  /** Rows the two `aml_alerts` queries (dedupe keys, open cases) answer with. */
  let alertState: {
    existingKeys: string[];
    openCaseRows: Array<{ userId: string; ruleCode: string }>;
  };

  function build(): TransactionMonitoringService {
    return new TransactionMonitoringService(
      investmentRepo,
      distributionRepo,
      logRepo,
      userRepo,
      alertRepo,
      runRepo,
      rulesService,
      caseService,
      ruleEngine,
      auditService,
      config,
    );
  }

  beforeEach(() => {
    investmentRepo = makeRepo();
    distributionRepo = makeRepo();
    logRepo = makeRepo();
    userRepo = makeRepo();
    runRepo = makeRepo();
    runRepo.create = jest.fn((payload: any) => ({ ...payload, id: 'run-1' }));
    alertState = { existingKeys: [], openCaseRows: [] };

    alertRepo = makeRepo();
    alertRepo.create = jest.fn((payload: any) => ({
      ...payload,
      id: 'alert-1',
    }));
    alertRepo.createQueryBuilder = jest.fn(() => {
      let query: 'keys' | 'cases' = 'keys';
      const qb: any = {
        select: jest.fn(() => qb),
        addSelect: jest.fn(() => qb),
        innerJoin: jest.fn(() => {
          query = 'cases';
          return qb;
        }),
        where: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        getRawMany: jest.fn(async () =>
          query === 'cases'
            ? alertState.openCaseRows
            : alertState.existingKeys.map((dedupeKey) => ({ dedupeKey })),
        ),
      };
      return qb;
    });

    rulesService = { activeFlowRules: jest.fn(async () => []) };
    caseService = {
      createCase: jest.fn(async () => ({
        id: 'case-1',
        caseNumber: 'AML-CASE-0001',
      })),
    };
    ruleEngine = {
      screenTransaction: jest.fn(async () => ({
        decision: 'ALLOW',
        matchedRules: [],
        executionId: 'exec-1',
      })),
    };
    auditService = { logEvent: jest.fn(async () => null) };
    config = { get: jest.fn((key: string, dflt?: string) => dflt) };

    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = build();
    (service as any).logger = logger;
  });

  // ── isEnabled ───────────────────────────────────────────────────────────

  describe('isEnabled', () => {
    it('is enabled by default', () => {
      expect(service.isEnabled).toBe(true);
    });

    it('treats a case-insensitive "false" flag as disabled', () => {
      config.get.mockImplementation((key: string, dflt?: string) =>
        key === 'AML_MONITORING_ENABLED' ? 'FALSE' : dflt,
      );
      expect(service.isEnabled).toBe(false);
    });
  });

  // ── loadCashFlows ───────────────────────────────────────────────────────

  describe('loadCashFlows', () => {
    beforeEach(() => {
      investmentRepo.qb.getRawMany.mockResolvedValue([
        {
          id: 'inv-1',
          userId: 'user-1',
          amountUsd: '1500.25',
          at: new Date('2026-10-01T05:00:00.000Z'),
          dealId: 'deal-1',
          counterpartyCountry: 'NG',
          commodity: 'Cocoa',
        },
      ]);
      distributionRepo.qb.getRawMany.mockResolvedValue([
        {
          id: 'dist-1',
          userId: 'user-1',
          amountUsd: 500,
          at: '2026-10-01T06:00:00.000Z',
          dealId: null,
          counterpartyCountry: null,
          commodity: null,
        },
      ]);
      logRepo.qb.getRawMany.mockResolvedValue([
        { id: 'log-1', userId: 'user-1', at: IN_WINDOW_AT, dealId: undefined },
      ]);
    });

    it('maps investments to inflows, payouts and on-chain logs to outflows', async () => {
      const flows = await service.loadCashFlows(WINDOW_START, WINDOW_END);

      expect(flows).toHaveLength(3);
      expect(flows[0]).toEqual({
        id: 'inv-1',
        userId: 'user-1',
        direction: 'in',
        amountUsd: 1500.25,
        at: new Date('2026-10-01T05:00:00.000Z'),
        dealId: 'deal-1',
        source: 'investments',
        counterpartyCountry: 'NG',
        commodity: 'Cocoa',
      });
      expect(flows[1]).toMatchObject({
        id: 'dist-1',
        direction: 'out',
        source: 'payment_distributions',
        amountUsd: 500,
        dealId: null,
        counterpartyCountry: null,
        commodity: null,
      });
      expect(flows[1].at).toBeInstanceOf(Date);
      expect(flows[2]).toMatchObject({
        id: 'log-1',
        direction: 'out',
        source: 'transaction_logs',
        amountUsd: 0,
        dealId: null,
        counterpartyCountry: null,
      });
    });

    it('drops rows that carry no account id', async () => {
      investmentRepo.qb.getRawMany.mockResolvedValue([
        { id: 'inv-orphan', userId: null, amountUsd: 900, at: IN_WINDOW_AT },
      ]);

      const flows = await service.loadCashFlows(WINDOW_START, WINDOW_END);

      expect(flows.map((flow) => flow.id)).toEqual(['dist-1', 'log-1']);
    });

    it('narrows every source query to one account when a userId is given', async () => {
      await service.loadCashFlows(WINDOW_START, WINDOW_END, 'user-9');

      expect(investmentRepo.qb.andWhere).toHaveBeenCalledWith(
        'investment.investor_id = :userId',
        { userId: 'user-9' },
      );
      expect(distributionRepo.qb.andWhere).toHaveBeenCalledWith(
        'distribution.recipient_id = :userId',
        { userId: 'user-9' },
      );
      expect(logRepo.qb.andWhere).toHaveBeenCalledWith(
        'log.user_id = :userId',
        { userId: 'user-9' },
      );
    });

    it('leaves the account predicates out for a whole-market sweep', async () => {
      await service.loadCashFlows(WINDOW_START, WINDOW_END);

      const logged = investmentRepo.qb.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(logged).not.toContain('investment.investor_id = :userId');
    });
  });

  // ── groupByUser (private) ───────────────────────────────────────────────

  describe('groupByUser', () => {
    it('buckets flows per account in chronological order', () => {
      const grouped: Map<string, CashFlow[]> = (service as any).groupByUser([
        makeFlow({ id: 'b', userId: 'user-2', at: IN_WINDOW_AT }),
        makeFlow({
          id: 'a',
          userId: 'user-1',
          at: new Date('2026-10-01T09:00:00.000Z'),
        }),
        makeFlow({
          id: 'c',
          userId: 'user-1',
          at: new Date('2026-10-01T01:00:00.000Z'),
        }),
      ]);

      expect([...grouped.keys()].sort()).toEqual(['user-1', 'user-2']);
      expect(grouped.get('user-1')?.map((flow) => flow.id)).toEqual(['c', 'a']);
    });

    it('keeps a flow without an account in its own bucket; loadCashFlows filters it upstream', () => {
      const grouped: Map<string, CashFlow[]> = (service as any).groupByUser([
        makeFlow({ userId: '' }),
      ]);

      expect([...grouped.keys()]).toEqual(['']);
    });
  });

  // ── engineDecision (private) ────────────────────────────────────────────

  describe('engineDecision', () => {
    it('returns the regulatory engine verdict', async () => {
      ruleEngine.screenTransaction.mockResolvedValue({
        decision: 'FLAG_REVIEW',
        matchedRules: [{ ruleCode: 'CAP-1' }, { ruleCode: 'EMBARGO-1' }],
        executionId: 'exec-42',
      });

      const decision = await (service as any).engineDecision(
        makeMatch({ amountUsd: 2500 }),
        [makeFlow()],
      );

      expect(ruleEngine.screenTransaction).toHaveBeenCalledWith({
        id: 'flow-1',
        amountUsd: 2500,
        fromCountry: 'NG',
        toCountry: 'NG',
        commodity: 'Cocoa',
      });
      expect(decision).toEqual({
        regulatoryDecision: 'FLAG_REVIEW',
        regulatoryMatchedRules: ['CAP-1', 'EMBARGO-1'],
        regulatoryExecutionId: 'exec-42',
      });
    });

    it('screens the flow that triggered the match and falls back to GLOBAL countries', async () => {
      const second = makeFlow({
        id: 'flow-2',
        counterpartyCountry: null,
        commodity: null,
        amountUsd: 700,
      });

      await (service as any).engineDecision(
        makeMatch({ flowIds: ['flow-2'], amountUsd: undefined }),
        [makeFlow(), second],
      );

      expect(ruleEngine.screenTransaction).toHaveBeenCalledWith({
        id: 'flow-2',
        amountUsd: 700,
        fromCountry: 'GLOBAL',
        toCountry: 'GLOBAL',
        commodity: '',
      });
    });

    it('records an engine outage instead of failing the sweep', async () => {
      ruleEngine.screenTransaction.mockRejectedValue(new Error('engine down'));

      const decision = await (service as any).engineDecision(makeMatch(), [
        makeFlow(),
      ]);

      expect(decision).toEqual({ regulatoryDecision: 'engine_unavailable' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('engine down'),
      );
    });

    it('has nothing to screen when the account has no flows', async () => {
      const decision = await (service as any).engineDecision(
        makeMatch(),
        [] as CashFlow[],
      );

      expect(decision).toEqual({});
      expect(ruleEngine.screenTransaction).not.toHaveBeenCalled();
    });
  });

  // ── findExistingKeys (private) ──────────────────────────────────────────

  describe('findExistingKeys', () => {
    it('returns only the keys already stored as alerts', async () => {
      alertState.existingKeys = ['k1'];

      const found: Set<string> = await (service as any).findExistingKeys([
        'k1',
        'k2',
      ]);

      expect(found).toEqual(new Set(['k1']));
    });

    it('skips the query entirely for an empty key list', async () => {
      const found: Set<string> = await (service as any).findExistingKeys([]);

      expect(found).toEqual(new Set());
      expect(alertRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ── evaluate ────────────────────────────────────────────────────────────

  describe('evaluate', () => {
    it('reports candidates only for flows inside the window', async () => {
      const flowsByUser = new Map<string, CashFlow[]>([
        [
          'user-1',
          [
            makeFlow({
              id: 'outside',
              at: new Date('2026-09-30T23:00:00.000Z'),
            }),
            makeFlow({ id: 'inside' }),
          ],
        ],
      ]);
      const users = new Map<string, string | null>([['user-1', 'NG']]);

      const candidates = await service.evaluate(
        flowsByUser,
        [makeRule()],
        users,
        WINDOW_START,
        WINDOW_END,
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].match.flowIds).toEqual(['inside']);
      expect(candidates[0].userId).toBe('user-1');
    });

    it('skips accounts with no in-window activity even when history exists', async () => {
      const flowsByUser = new Map<string, CashFlow[]>([
        ['user-1', [makeFlow({ at: new Date('2026-09-29T01:00:00.000Z') })]],
      ]);

      const candidates = await service.evaluate(
        flowsByUser,
        [makeRule()],
        new Map<string, string | null>(),
        WINDOW_START,
        WINDOW_END,
      );

      expect(candidates).toEqual([]);
    });

    it('feeds the account country into the jurisdiction detector', async () => {
      const flowsByUser = new Map<string, CashFlow[]>([
        ['user-1', [makeFlow({ counterpartyCountry: 'CH' })]],
      ]);
      const rule = makeRule({
        id: 'rule-jur',
        ruleCode: 'JUR-1',
        patternType: 'HIGH_RISK_JURISDICTION',
        parameters: { countries: ['NG'] },
      });

      const candidates = await service.evaluate(
        flowsByUser,
        [rule],
        new Map<string, string | null>([['user-1', 'NG']]),
        WINDOW_START,
        WINDOW_END,
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].match.patternType).toBe('HIGH_RISK_JURISDICTION');
      expect(candidates[0].match.dedupeKey).toBe(
        'JUR-1:jurisdiction:user-1:NG',
      );
    });

    it('ignores disabled rules and patterns with no flow detector', async () => {
      const flowsByUser = new Map<string, CashFlow[]>([
        ['user-1', [makeFlow({ amountUsd: 5000 })]],
      ]);

      const candidates = await service.evaluate(
        flowsByUser,
        [
          makeRule({ enabled: false }),
          makeRule({ patternType: 'SANCTIONS_MATCH' }),
        ],
        new Map<string, string | null>(),
        WINDOW_START,
        WINDOW_END,
      );

      expect(candidates).toEqual([]);
    });

    it('applies the rule sensitivity to the candidate score', async () => {
      const flowsByUser = new Map<string, CashFlow[]>([
        ['user-1', [makeFlow()]],
      ]);

      const candidates = await service.evaluate(
        flowsByUser,
        [makeRule({ sensitivityMultiplier: 0.5 })],
        new Map<string, string | null>(),
        WINDOW_START,
        WINDOW_END,
      );

      expect(candidates[0].match.riskScore).toBe(40);
    });
  });

  // ── runSweep ────────────────────────────────────────────────────────────

  describe('runSweep', () => {
    /** One 1000 USD inflow for user-1, exactly at the HIGH_VALUE threshold. */
    function queueOneHighValueFlow(): void {
      rulesService.activeFlowRules.mockResolvedValue([makeRule()]);
      investmentRepo.qb.getRawMany.mockResolvedValue([
        {
          id: 'inv-1',
          userId: 'user-1',
          amountUsd: 1000,
          at: '2026-10-01T06:00:00.000Z',
          dealId: 'deal-1',
          counterpartyCountry: 'NG',
          commodity: 'Cocoa',
        },
      ]);
      userRepo.qb.getRawMany.mockResolvedValue([
        { id: 'user-1', country: 'NG' },
      ]);
    }

    it('skips everything when monitoring is disabled', async () => {
      config.get.mockImplementation((key: string, dflt?: string) =>
        key === 'AML_MONITORING_ENABLED' ? 'false' : dflt,
      );

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(result).toMatchObject({
        runId: null,
        usersEvaluated: 0,
        flowsEvaluated: 0,
        rulesApplied: 0,
        alertsRaised: 0,
        alertsSkippedDuplicate: 0,
        alertsBelowThreshold: 0,
        casesOpened: [],
        status: 'skipped',
      });
      expect(result.windowStart).toEqual(WINDOW_START);
      expect(result.windowEnd).toEqual(WINDOW_END);
      expect(rulesService.activeFlowRules).not.toHaveBeenCalled();
      expect(runRepo.save).not.toHaveBeenCalled();
      expect(alertRepo.save).not.toHaveBeenCalled();
    });

    it('defaults the window to the last 24 hours and loads earlier context', async () => {
      queueOneHighValueFlow();

      const result = await service.runSweep();

      expect(
        Math.abs(
          result.windowEnd.getTime() -
            result.windowStart.getTime() -
            24 * HOUR_MS,
        ),
      ).toBeLessThan(5_000);
      const loadFrom = investmentRepo.qb.where.mock.calls[0][1] as {
        from: Date;
      };
      expect(loadFrom.from.getTime()).toBeLessThan(
        result.windowStart.getTime(),
      );
    });

    it('reports candidates without persisting anything on a dry run', async () => {
      queueOneHighValueFlow();

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        dryRun: true,
      });

      expect(result.alertsRaised).toBe(1);
      expect(result.status).toBe('completed');
      expect(result.runId).toBeNull();
      expect(runRepo.save).not.toHaveBeenCalled();
      expect(runRepo.update).not.toHaveBeenCalled();
      expect(alertRepo.save).not.toHaveBeenCalled();
      expect(caseService.createCase).not.toHaveBeenCalled();
      expect(ruleEngine.screenTransaction).not.toHaveBeenCalled();
      expect(auditService.logEvent).not.toHaveBeenCalled();
    });

    it('counts a stored dedupe key as a duplicate rather than a new alert', async () => {
      queueOneHighValueFlow();
      alertState.existingKeys = ['HV-1:high-value:inv-1'];

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(result.alertsSkippedDuplicate).toBe(1);
      expect(result.alertsRaised).toBe(0);
      expect(alertRepo.save).not.toHaveBeenCalled();
      expect(caseService.createCase).not.toHaveBeenCalled();
    });

    it('holds back findings below the rule alert threshold', async () => {
      rulesService.activeFlowRules.mockResolvedValue([
        makeRule({ alertThresholdScore: 90 }),
      ]);
      investmentRepo.qb.getRawMany.mockResolvedValue([
        {
          id: 'inv-1',
          userId: 'user-1',
          amountUsd: 1000,
          at: '2026-10-01T06:00:00.000Z',
        },
      ]);
      userRepo.qb.getRawMany.mockResolvedValue([
        { id: 'user-1', country: 'NG' },
      ]);

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(result.alertsBelowThreshold).toBe(1);
      expect(result.alertsRaised).toBe(0);
      expect(alertRepo.save).not.toHaveBeenCalled();
    });

    it('raises an alert and opens a case once the auto-case score is reached', async () => {
      queueOneHighValueFlow();

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(result.alertsRaised).toBe(1);
      expect(result.casesOpened).toEqual(['AML-CASE-0001']);
      expect(result.usersEvaluated).toBe(1);
      expect(result.flowsEvaluated).toBe(1);
      expect(result.rulesApplied).toBe(1);
      expect(ruleEngine.screenTransaction).toHaveBeenCalled();
      expect(alertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patternType: 'HIGH_VALUE',
          ruleId: 'rule-hv',
          ruleCode: 'HV-1',
          userId: 'user-1',
          dealId: 'deal-1',
          severity: 'HIGH',
          riskScore: 80,
          amountUsd: 1000,
          status: 'pending',
          dedupeKey: 'HV-1:high-value:inv-1',
          runId: 'run-1',
          evidence: expect.objectContaining({
            flowIds: ['inv-1'],
            regulatory: {
              regulatoryDecision: 'ALLOW',
              regulatoryMatchedRules: [],
              regulatoryExecutionId: 'exec-1',
            },
          }),
        }),
      );
      expect(caseService.createCase).toHaveBeenCalledWith({
        alertIds: ['alert-1'],
        subjectUserId: 'user-1',
      });
    });

    it('stays under the auto-case threshold when the configured score is higher', async () => {
      queueOneHighValueFlow();
      config.get.mockImplementation((key: string, dflt?: string) =>
        key === 'AML_AUTO_CASE_THRESHOLD_SCORE' ? '90' : dflt,
      );

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(result.alertsRaised).toBe(1);
      expect(result.casesOpened).toEqual([]);
      expect(caseService.createCase).not.toHaveBeenCalled();
    });

    it('does not open a second case for a rule that already has one open', async () => {
      queueOneHighValueFlow();
      alertState.openCaseRows = [{ userId: 'user-1', ruleCode: 'HV-1' }];

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(result.alertsRaised).toBe(1);
      expect(result.casesOpened).toEqual([]);
      expect(caseService.createCase).not.toHaveBeenCalled();
    });

    it('opens one case per rule even when several alerts fire for it', async () => {
      rulesService.activeFlowRules.mockResolvedValue([makeRule()]);
      investmentRepo.qb.getRawMany.mockResolvedValue([
        {
          id: 'inv-1',
          userId: 'user-1',
          amountUsd: 1000,
          at: '2026-10-01T06:00:00.000Z',
        },
        {
          id: 'inv-2',
          userId: 'user-1',
          amountUsd: 1000,
          at: '2026-10-01T07:00:00.000Z',
        },
      ]);
      userRepo.qb.getRawMany.mockResolvedValue([
        { id: 'user-1', country: 'NG' },
      ]);

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(result.alertsRaised).toBe(2);
      expect(result.casesOpened).toEqual(['AML-CASE-0001']);
      expect(caseService.createCase).toHaveBeenCalledTimes(1);
    });

    it('writes the monitoring run row and the audit event', async () => {
      queueOneHighValueFlow();

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        trigger: 'cron',
      });

      expect(runRepo.create).toHaveBeenCalledWith({
        triggerType: 'cron',
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        status: 'running',
        rulesApplied: 1,
      });
      expect(runRepo.update).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({
          status: 'completed',
          usersEvaluated: 1,
          flowsEvaluated: 1,
          alertsRaised: 1,
          casesOpened: 1,
          durationMs: expect.any(Number),
          finishedAt: expect.any(Date),
        }),
      );
      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'AML_MONITORING_SWEEP',
          statusCode: 200,
          requestDetails: expect.objectContaining({ runId: 'run-1' }),
        }),
      );
      expect(result).toMatchObject({ runId: 'run-1', status: 'completed' });
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('AML sweep'),
      );
    });

    it('restricts the sweep to one account when a userId is supplied', async () => {
      queueOneHighValueFlow();

      await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        userId: 'user-1',
      });

      expect(investmentRepo.qb.andWhere).toHaveBeenCalledWith(
        'investment.investor_id = :userId',
        { userId: 'user-1' },
      );
      expect(userRepo.qb.where).toHaveBeenCalledWith(
        'user.id IN (:...userIds)',
        { userIds: ['user-1'] },
      );
    });

    it('completes an empty window without touching the user lookup', async () => {
      rulesService.activeFlowRules.mockResolvedValue([makeRule()]);

      const result = await service.runSweep({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(result).toMatchObject({
        usersEvaluated: 0,
        flowsEvaluated: 0,
        alertsRaised: 0,
        status: 'completed',
      });
      expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ── monitorUser / alertsForUser / rulesForPreview ───────────────────────

  describe('monitorUser', () => {
    it('narrows the window to the lookback and delegates to runSweep', async () => {
      const spy = jest
        .spyOn(service, 'runSweep')
        .mockResolvedValue({ runId: null } as any);

      const result = await service.monitorUser('user-1', 48, true);

      const options = spy.mock.calls[0][0];
      expect(options).toMatchObject({
        userId: 'user-1',
        dryRun: true,
        trigger: 'manual',
      });
      expect(
        (options.windowEnd as Date).getTime() -
          (options.windowStart as Date).getTime(),
      ).toBe(48 * HOUR_MS);
      expect(result).toEqual({ runId: null });
    });

    it('defaults to a 30 day lookback with persisted alerts', async () => {
      const spy = jest
        .spyOn(service, 'runSweep')
        .mockResolvedValue({ runId: null } as any);

      await service.monitorUser('user-1');

      const options = spy.mock.calls[0][0];
      expect(options.dryRun).toBe(false);
      expect(
        (options.windowEnd as Date).getTime() -
          (options.windowStart as Date).getTime(),
      ).toBe(24 * 30 * HOUR_MS);
    });
  });

  describe('alertsForUser', () => {
    it('returns the newest alerts up to the limit', async () => {
      const alerts = [{ id: 'alert-1' }, { id: 'alert-2' }];
      alertRepo.find.mockResolvedValue(alerts);

      const result = await service.alertsForUser('user-1', 5);

      expect(result).toEqual(alerts);
      expect(alertRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC' },
        take: 5,
      });
    });

    it('limits to 20 alerts by default', async () => {
      await service.alertsForUser('user-1');

      expect(alertRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });
  });

  it('rulesForPreview hands back the active flow rules', async () => {
    const rules = [makeRule()];
    rulesService.activeFlowRules.mockResolvedValue(rules);

    await expect(service.rulesForPreview()).resolves.toBe(rules);
  });
});
