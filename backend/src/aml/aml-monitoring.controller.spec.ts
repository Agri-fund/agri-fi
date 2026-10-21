import { AmlMonitoringController } from './aml-monitoring.controller';
import type { RunSweepDto } from './dto/aml-monitoring.dto';

// The shared guards barrel (src/common/guards/index.ts) re-exports an
// `AdminGuard` from a module that does not exist, so requiring it throws at
// module-load time. The controller only uses `RolesGuard` as a `@UseGuards`
// reference, so stub the barrel to let the real delegation code load.
jest.mock('../common/guards', () => ({
  RolesGuard: class RolesGuard {},
}));

interface Mocks {
  rules: any;
  monitoring: any;
  cases: any;
  sanctionsList: any;
  screening: any;
  sars: any;
  reporting: any;
}

function makeMocks(): Mocks {
  return {
    rules: {
      listRules: jest.fn().mockResolvedValue([]),
      createRule: jest.fn().mockResolvedValue({ id: 'rule-1' }),
      ensureDefaults: jest.fn().mockResolvedValue({ created: [] }),
      updateRule: jest.fn().mockResolvedValue({ id: 'rule-1' }),
      setEnabled: jest.fn().mockResolvedValue({ id: 'rule-1' }),
    },
    monitoring: {
      isEnabled: true,
      runSweep: jest.fn().mockResolvedValue({ alertsRaised: 0 }),
      monitorUser: jest.fn().mockResolvedValue({ alertsRaised: 0 }),
      alertsForUser: jest.fn().mockResolvedValue([{ id: 'alert-1' }]),
    },
    cases: {
      listAlerts: jest.fn().mockResolvedValue([]),
      triageAlert: jest.fn().mockResolvedValue({ id: 'alert-1' }),
      listCases: jest.fn().mockResolvedValue([]),
      summary: jest.fn().mockResolvedValue({ open: 2 }),
      overdueCases: jest.fn().mockResolvedValue([]),
      createCase: jest.fn().mockResolvedValue({ id: 'case-1' }),
      getCase: jest.fn().mockResolvedValue({ id: 'case-1' }),
      attachAlerts: jest.fn().mockResolvedValue({ id: 'case-1' }),
      updateCase: jest.fn().mockResolvedValue({ id: 'case-1' }),
      closeCase: jest.fn().mockResolvedValue({ id: 'case-1' }),
    },
    sanctionsList: {
      countBySource: jest.fn().mockResolvedValue({ OFAC: 5 }),
      listPeps: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: 'entry-1' }),
      importList: jest.fn().mockResolvedValue({ imported: 0 }),
      candidatesForName: jest.fn().mockResolvedValue([{ id: 'entry-1' }]),
    },
    screening: {
      screenSubject: jest.fn().mockResolvedValue({ decision: 'clear' }),
      rescreenVerifiedUsers: jest.fn().mockResolvedValue({ screened: 0 }),
    },
    sars: {
      listSars: jest.fn().mockResolvedValue([]),
      analytics: jest.fn().mockResolvedValue({ total: 0 }),
      generate: jest.fn().mockResolvedValue({ id: 'sar-1' }),
      getSar: jest.fn().mockResolvedValue({ id: 'sar-1' }),
      markReviewed: jest.fn().mockResolvedValue({ id: 'sar-1' }),
      verifyIntegrity: jest.fn().mockResolvedValue({ valid: true }),
    },
    reporting: {
      submit: jest.fn().mockResolvedValue({ status: 'pending' }),
      listSubmissions: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      reportingMetrics: jest.fn().mockResolvedValue({ acceptanceRate: 0 }),
      retry: jest.fn().mockResolvedValue({ status: 'accepted' }),
      markAcknowledged: jest.fn().mockResolvedValue({ id: 'sub-1' }),
    },
  };
}

const req = { user: { id: 'actor-1' } };

describe('AmlMonitoringController', () => {
  let mocks: Mocks;
  let controller: AmlMonitoringController;

  beforeEach(() => {
    mocks = makeMocks();
    controller = new AmlMonitoringController(
      mocks.rules,
      mocks.monitoring,
      mocks.cases,
      mocks.sanctionsList,
      mocks.screening,
      mocks.sars,
      mocks.reporting,
    );
  });

  // --------------------------------------------------------------------- rules

  describe('rules', () => {
    it('listRules maps "true" to enabledOnly true', async () => {
      await controller.listRules('true');
      expect(mocks.rules.listRules).toHaveBeenCalledWith(true);
    });

    it('listRules treats any other value as enabledOnly false', async () => {
      await controller.listRules('nope');
      expect(mocks.rules.listRules).toHaveBeenCalledWith(false);
      await controller.listRules();
      expect(mocks.rules.listRules).toHaveBeenLastCalledWith(false);
    });

    it('createRule forwards the dto and actor id', async () => {
      const dto = { ruleCode: 'R-1', name: 'Rule', patternType: 'VELOCITY' };
      await controller.createRule(req as any, dto as any);
      expect(mocks.rules.createRule).toHaveBeenCalledWith(dto, 'actor-1');
    });

    it('seedRules calls ensureDefaults with the actor', async () => {
      await controller.seedRules(req as any);
      expect(mocks.rules.ensureDefaults).toHaveBeenCalledWith('actor-1');
    });

    it('updateRule forwards id and dto', async () => {
      const dto = { name: 'Updated' };
      await controller.updateRule('rule-1', dto as any);
      expect(mocks.rules.updateRule).toHaveBeenCalledWith('rule-1', dto);
    });

    it('setRuleEnabled only passes true for boolean true', async () => {
      await controller.setRuleEnabled('rule-1', { enabled: true });
      expect(mocks.rules.setEnabled).toHaveBeenCalledWith('rule-1', true);
      await controller.setRuleEnabled('rule-1', { enabled: false });
      expect(mocks.rules.setEnabled).toHaveBeenLastCalledWith('rule-1', false);
      await controller.setRuleEnabled('rule-1', {} as any);
      expect(mocks.rules.setEnabled).toHaveBeenLastCalledWith('rule-1', false);
    });
  });

  // ---------------------------------------------------------------- monitoring

  describe('monitoring', () => {
    it('runSweep converts ISO window dates and marks the trigger manual', async () => {
      const dto: RunSweepDto = {
        windowStart: '2026-03-01T00:00:00.000Z',
        windowEnd: '2026-03-08T00:00:00.000Z',
        userId: 'user-1',
      };
      await controller.runSweep(dto);
      expect(mocks.monitoring.runSweep).toHaveBeenCalledWith({
        windowStart: new Date('2026-03-01T00:00:00.000Z'),
        windowEnd: new Date('2026-03-08T00:00:00.000Z'),
        userId: 'user-1',
        dryRun: false,
        trigger: 'manual',
      });
    });

    it('runSweep turns invalid or absent dates into undefined', async () => {
      await controller.runSweep({
        windowStart: 'not-a-date',
        windowEnd: '',
      });
      expect(mocks.monitoring.runSweep).toHaveBeenCalledWith({
        windowStart: undefined,
        windowEnd: undefined,
        userId: undefined,
        dryRun: false,
        trigger: 'manual',
      });
    });

    it('runSweep honours an explicit dryRun flag', async () => {
      await controller.runSweep({ dryRun: true });
      expect(mocks.monitoring.runSweep).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true, trigger: 'manual' }),
      );
    });

    it('monitorUser parses a positive lookback window', async () => {
      await controller.monitorUser('user-1', '48', 'true');
      expect(mocks.monitoring.monitorUser).toHaveBeenCalledWith(
        'user-1',
        48,
        true,
      );
    });

    it('monitorUser falls back to 30 days for garbage or absent lookback', async () => {
      await controller.monitorUser('user-1', 'abc', undefined);
      expect(mocks.monitoring.monitorUser).toHaveBeenCalledWith(
        'user-1',
        24 * 30,
        false,
      );
      await controller.monitorUser('user-1', undefined, 'false');
      expect(mocks.monitoring.monitorUser).toHaveBeenLastCalledWith(
        'user-1',
        24 * 30,
        false,
      );
    });

    it('listAlerts forwards the query object', async () => {
      const query = { status: 'pending', page: 0, limit: 20 };
      await controller.listAlerts(query as any);
      expect(mocks.cases.listAlerts).toHaveBeenCalledWith(query);
    });

    it('userAlerts wraps the alerts in an items array', async () => {
      const result = await controller.userAlerts('user-1');
      expect(mocks.monitoring.alertsForUser).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ items: [{ id: 'alert-1' }] });
    });

    it('triageAlert passes reason or null plus the actor', async () => {
      await controller.triageAlert(req as any, 'alert-1', {
        disposition: 'false_positive',
        reason: 'Low risk',
      } as any);
      expect(mocks.cases.triageAlert).toHaveBeenCalledWith(
        'alert-1',
        'false_positive',
        'Low risk',
        'actor-1',
      );

      await controller.triageAlert(req as any, 'alert-2', {
        disposition: 'no_action',
      } as any);
      expect(mocks.cases.triageAlert).toHaveBeenLastCalledWith(
        'alert-2',
        'no_action',
        null,
        'actor-1',
      );
    });
  });

  // --------------------------------------------------------------------- cases

  describe('cases', () => {
    it('listCases forwards the query', async () => {
      const query = { assignedTo: 'actor-1', page: 1 };
      await controller.listCases(query as any);
      expect(mocks.cases.listCases).toHaveBeenCalledWith(query);
    });

    it('caseSummary and overdueCases delegate directly', async () => {
      await controller.caseSummary();
      expect(mocks.cases.summary).toHaveBeenCalled();
      await controller.overdueCases();
      expect(mocks.cases.overdueCases).toHaveBeenCalled();
    });

    it('createCase forwards dto and actor', async () => {
      const dto = { title: 'New case' };
      await controller.createCase(req as any, dto as any);
      expect(mocks.cases.createCase).toHaveBeenCalledWith(dto, 'actor-1');
    });

    it('getCase forwards the id', async () => {
      await controller.getCase('case-1');
      expect(mocks.cases.getCase).toHaveBeenCalledWith('case-1');
    });

    it('attachAlerts defaults a missing body to an empty list', async () => {
      await controller.attachAlerts(req as any, 'case-1', {
        alertIds: ['a1', 'a2'],
      });
      expect(mocks.cases.attachAlerts).toHaveBeenCalledWith(
        'case-1',
        ['a1', 'a2'],
        'actor-1',
      );

      await controller.attachAlerts(req as any, 'case-2', {} as any);
      expect(mocks.cases.attachAlerts).toHaveBeenLastCalledWith(
        'case-2',
        [],
        'actor-1',
      );
    });

    it('updateCase and closeCase forward dto and actor', async () => {
      const updateDto = { status: 'in_review' };
      await controller.updateCase(req as any, 'case-1', updateDto as any);
      expect(mocks.cases.updateCase).toHaveBeenCalledWith(
        'case-1',
        updateDto,
        'actor-1',
      );

      const closeDto = { disposition: 'false_positive' };
      await controller.closeCase(req as any, 'case-1', closeDto as any);
      expect(mocks.cases.closeCase).toHaveBeenCalledWith(
        'case-1',
        closeDto,
        'actor-1',
      );
    });
  });

  // ----------------------------------------------------------------- sanctions

  describe('sanctions', () => {
    it('sanctionsCounts delegates to countBySource', async () => {
      await controller.sanctionsCounts();
      expect(mocks.sanctionsList.countBySource).toHaveBeenCalled();
    });

    it('listPeps parses the limit and defaults to 100', async () => {
      await controller.listPeps('25');
      expect(mocks.sanctionsList.listPeps).toHaveBeenCalledWith(25);
      await controller.listPeps(undefined);
      expect(mocks.sanctionsList.listPeps).toHaveBeenLastCalledWith(100);
      await controller.listPeps('0');
      expect(mocks.sanctionsList.listPeps).toHaveBeenLastCalledWith(100);
      await controller.listPeps('junk');
      expect(mocks.sanctionsList.listPeps).toHaveBeenLastCalledWith(100);
    });

    it('upsertEntry forwards the dto', async () => {
      const dto = {
        listSource: 'OFAC',
        name: 'Ivan Ivanov',
        entryType: 'PERSON',
      };
      await controller.upsertEntry(dto as any);
      expect(mocks.sanctionsList.upsert).toHaveBeenCalledWith(dto);
    });

    it('importList forwards the dto', async () => {
      const dto = { listSource: 'UN', entries: [] };
      await controller.importList(dto as any);
      expect(mocks.sanctionsList.importList).toHaveBeenCalledWith(dto);
    });

    it('previewName wraps candidates and defaults the name to empty', async () => {
      const result = await controller.previewName({ name: 'Ivan' });
      expect(mocks.sanctionsList.candidatesForName).toHaveBeenCalledWith(
        'Ivan',
      );
      expect(result).toEqual({ items: [{ id: 'entry-1' }] });

      await controller.previewName({} as any);
      expect(mocks.sanctionsList.candidatesForName).toHaveBeenLastCalledWith(
        '',
      );
    });

    it('screenSubject forwards dto and actor', async () => {
      const dto = { subjectType: 'user', subjectId: 'user-1' };
      await controller.screenSubject(req as any, dto as any);
      expect(mocks.screening.screenSubject).toHaveBeenCalledWith(
        dto,
        'actor-1',
      );
    });

    it('rescreen delegates to rescreenVerifiedUsers', async () => {
      await controller.rescreen();
      expect(mocks.screening.rescreenVerifiedUsers).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------------- SAR

  describe('SAR', () => {
    it('listSars parses the limit and defaults to 50', async () => {
      await controller.listSars('draft', '10');
      expect(mocks.sars.listSars).toHaveBeenCalledWith('draft', 10);
      await controller.listSars(undefined, undefined);
      expect(mocks.sars.listSars).toHaveBeenLastCalledWith(undefined, 50);
    });

    it('sarAnalytics delegates to analytics', async () => {
      await controller.sarAnalytics();
      expect(mocks.sars.analytics).toHaveBeenCalled();
    });

    it('generateSar forwards dto and actor', async () => {
      const dto = { caseId: 'case-1' };
      await controller.generateSar(req as any, dto as any);
      expect(mocks.sars.generate).toHaveBeenCalledWith(dto, 'actor-1');
    });

    it('getSar, reviewSar and verifySar forward correctly', async () => {
      await controller.getSar('sar-1');
      expect(mocks.sars.getSar).toHaveBeenCalledWith('sar-1');

      await controller.reviewSar(req as any, 'sar-1');
      expect(mocks.sars.markReviewed).toHaveBeenCalledWith('sar-1', 'actor-1');

      await controller.verifySar('sar-1');
      expect(mocks.sars.verifyIntegrity).toHaveBeenCalledWith('sar-1');
    });
  });

  // ------------------------------------------------------------------- filings

  describe('filings', () => {
    it('submit forwards dto and actor', async () => {
      const dto = { sarReportId: 'sar-1' };
      await controller.submit(req as any, dto as any);
      expect(mocks.reporting.submit).toHaveBeenCalledWith(dto, 'actor-1');
    });

    it('listSubmissions parses the limit and defaults to 50', async () => {
      await controller.listSubmissions('pending', '15');
      expect(mocks.reporting.listSubmissions).toHaveBeenCalledWith(
        'pending',
        15,
      );
      await controller.listSubmissions(undefined, undefined);
      expect(mocks.reporting.listSubmissions).toHaveBeenLastCalledWith(
        undefined,
        50,
      );
    });

    it('submissionMetrics delegates to reportingMetrics', async () => {
      await controller.submissionMetrics();
      expect(mocks.reporting.reportingMetrics).toHaveBeenCalled();
    });

    it('retrySubmission forwards id and actor', async () => {
      await controller.retrySubmission(req as any, 'sub-1');
      expect(mocks.reporting.retry).toHaveBeenCalledWith('sub-1', 'actor-1');
    });

    it('acknowledge passes authorityReference or null plus actor', async () => {
      await controller.acknowledge(req as any, 'sub-1', {
        authorityReference: 'AUTH-1',
      });
      expect(mocks.reporting.markAcknowledged).toHaveBeenCalledWith(
        'sub-1',
        'AUTH-1',
        'actor-1',
      );

      await controller.acknowledge(req as any, 'sub-2', {} as any);
      expect(mocks.reporting.markAcknowledged).toHaveBeenLastCalledWith(
        'sub-2',
        null,
        'actor-1',
      );
    });
  });

  // -------------------------------------------------------------------- status

  describe('status', () => {
    it('reports whether monitoring is enabled and the enabled rule count', async () => {
      mocks.rules.listRules.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
      const result = await controller.status();
      expect(mocks.rules.listRules).toHaveBeenCalledWith(true);
      expect(result).toEqual({ monitoringEnabled: true, enabledRules: 2 });
    });

    it('reflects a disabled monitoring engine', async () => {
      mocks.monitoring.isEnabled = false;
      mocks.rules.listRules.mockResolvedValue([]);
      const result = await controller.status();
      expect(result).toEqual({ monitoringEnabled: false, enabledRules: 0 });
    });
  });
});
