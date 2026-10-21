import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AmlCaseService } from './aml-case.service';
import { AmlCase, AmlCaseTimelineEntry } from './entities/aml-case.entity';
import { AmlAlert } from './entities/aml-alert.entity';
import { AmlMonitoringRule } from './entities/aml-monitoring-rule.entity';
import {
  AmlAlertStatus,
  AmlDisposition,
  AmlSeverity,
  sensitivityFromDisposition,
} from './aml.constants';

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
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
  return qb;
}

function createRepoMock(): any {
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

function makeCase(overrides: Partial<AmlCase> = {}): AmlCase {
  const target = new AmlCase();
  target.id = 'case-1';
  target.caseNumber = 'AML-CASE-2026-000007';
  target.title = 'AML review';
  target.summary = '';
  target.subjectUserId = null;
  target.priority = 'MEDIUM';
  target.status = 'open';
  target.assignedTo = null;
  target.openedBy = null;
  target.alertIds = [];
  target.riskScore = 0;
  target.exposureUsd = 0;
  target.subjectSnapshot = {};
  target.timeline = [];
  target.disposition = null;
  target.notes = null;
  target.dueAt = null;
  target.closedAt = null;
  return Object.assign(target, overrides);
}

function makeAlert(overrides: Partial<AmlAlert> = {}): AmlAlert {
  const alert = new AmlAlert();
  alert.id = 'alert-1';
  alert.patternType = 'STRUCTURING';
  alert.ruleId = 'rule-1';
  alert.ruleCode = 'AML-MON-STRUCT-001';
  alert.userId = 'user-1';
  alert.dealId = null;
  alert.severity = 'HIGH';
  alert.action = 'FLAG_REVIEW';
  alert.riskScore = 60;
  alert.amountUsd = 1000;
  alert.title = 'Sub-threshold clustering';
  alert.matchReason = 'three deposits';
  alert.evidence = {};
  alert.status = 'pending';
  alert.caseId = null;
  alert.runId = null;
  alert.dedupeKey = 'dedupe-1';
  alert.reviewedBy = null;
  alert.reviewedAt = null;
  return Object.assign(alert, overrides);
}

function makeRule(
  overrides: Partial<AmlMonitoringRule> = {},
): AmlMonitoringRule {
  const rule = new AmlMonitoringRule();
  rule.id = 'rule-1';
  rule.ruleCode = 'AML-MON-STRUCT-001';
  rule.name = 'Structuring';
  rule.patternType = 'STRUCTURING';
  rule.parameters = {};
  rule.enabled = true;
  rule.sensitivityMultiplier = 1;
  rule.falsePositiveCount = 0;
  rule.truePositiveCount = 0;
  rule.version = 1;
  return Object.assign(rule, overrides);
}

function timelineActions(target: AmlCase): string[] {
  return (target.timeline ?? []).map(
    (entry: AmlCaseTimelineEntry) => entry.action,
  );
}

function createdCaseInput(caseRepo: any): any {
  return caseRepo.create.mock.calls[caseRepo.create.mock.calls.length - 1][0];
}

describe('AmlCaseService', () => {
  let caseRepo: any;
  let alertRepo: any;
  let ruleRepo: any;
  let feedbackRepo: any;
  let audit: {
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    logEvent: jest.Mock;
  };
  let service: AmlCaseService;
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    caseRepo = createRepoMock();
    alertRepo = createRepoMock();
    ruleRepo = createRepoMock();
    feedbackRepo = createRepoMock();
    audit = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      logEvent: jest.fn().mockResolvedValue(null),
    };
    service = new AmlCaseService(
      caseRepo,
      alertRepo,
      ruleRepo,
      feedbackRepo,
      audit as any,
    );
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    (service as any).logger = logger;
  });

  describe('createCase', () => {
    it('generates the next case number for the current UTC year', async () => {
      const year = new Date().getUTCFullYear();
      caseRepo.qb.getCount.mockResolvedValue(4);

      await service.createCase({});

      expect(caseRepo.qb.where).toHaveBeenCalledWith(
        'case.caseNumber LIKE :prefix',
        { prefix: `AML-CASE-${year}-%` },
      );
      expect(createdCaseInput(caseRepo).caseNumber).toBe(
        `AML-CASE-${year}-000005`,
      );
    });

    it('pads the first sequence of the year to six digits', async () => {
      caseRepo.qb.getCount.mockResolvedValue(0);

      await service.createCase({});

      const year = new Date().getUTCFullYear();
      expect(createdCaseInput(caseRepo).caseNumber).toBe(
        `AML-CASE-${year}-000001`,
      );
    });

    const slaByPriority: Array<[AmlSeverity, number]> = [
      ['CRITICAL', 3],
      ['HIGH', 5],
      ['MEDIUM', 10],
      ['LOW', 30],
    ];

    for (const [priority, days] of slaByPriority) {
      it(`sets the ${priority} due date ${days} days after opening`, async () => {
        const before = Date.now();

        await service.createCase({ priority });

        const after = Date.now();
        const dueAt = createdCaseInput(caseRepo).dueAt as Date;
        const slaMs = days * 86_400_000;

        expect(dueAt.getTime()).toBeGreaterThanOrEqual(before + slaMs);
        expect(dueAt.getTime()).toBeLessThanOrEqual(after + slaMs);
      });
    }

    it('falls back to the MEDIUM SLA for an unknown priority', () => {
      const dueAt = (service as any).dueDate('NOT_A_PRIORITY' as AmlSeverity);

      expect(dueAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 86_400_000);
      expect(dueAt.getTime() - Date.now()).toBeGreaterThanOrEqual(
        10 * 86_400_000 - 5_000,
      );
    });

    it('roll-ups the attached alerts into the new case', async () => {
      alertRepo.find.mockResolvedValue([
        makeAlert({
          id: 'alert-1',
          severity: 'HIGH',
          riskScore: 60,
          amountUsd: 1500,
          patternType: 'STRUCTURING',
          ruleCode: 'AML-MON-STRUCT-001',
          title: 'Clustering',
          evidence: { flowIds: ['f1', 'f2'] },
        }),
        makeAlert({
          id: 'alert-2',
          severity: 'CRITICAL',
          riskScore: 85,
          amountUsd: 2500,
          patternType: 'LAYERING',
          ruleCode: 'AML-MON-LAYER-001',
          title: 'Layering',
          evidence: { flowIds: ['f2', 'f3'] },
        }),
      ]);

      await service.createCase({ alertIds: ['alert-1', 'alert-2'] }, 'admin-1');

      const created = createdCaseInput(caseRepo);
      expect(created.priority).toBe('CRITICAL');
      expect(created.riskScore).toBe(85);
      expect(created.exposureUsd).toBe(4000);
      expect(created.alertIds).toEqual(['alert-1', 'alert-2']);
      expect(created.subjectUserId).toBe('user-1');
      expect(created.title).toBe('AML review: STRUCTURING, LAYERING');
      expect(created.summary).toBe('- Clustering\n- Layering');
      expect(created.subjectSnapshot).toEqual({
        patterns: ['STRUCTURING', 'LAYERING'],
        ruleCodes: ['AML-MON-STRUCT-001', 'AML-MON-LAYER-001'],
        flowIds: ['f1', 'f2', 'f3'],
      });
      expect(created.openedBy).toBe('admin-1');
      expect(created.timeline).toHaveLength(1);
      expect(created.timeline[0].action).toBe('case_opened');
      expect(created.timeline[0].detail).toEqual({
        alertIds: ['alert-1', 'alert-2'],
      });
    });

    it('links the alerts and audits the creation', async () => {
      caseRepo.save.mockResolvedValue(
        makeCase({
          id: 'case-9',
          caseNumber: 'AML-CASE-2026-000042',
          alertIds: ['alert-1'],
        }),
      );
      alertRepo.find.mockResolvedValue([
        makeAlert({ id: 'alert-1', amountUsd: null }),
      ]);

      await service.createCase({ alertIds: ['alert-1'] }, 'admin-1');

      const [alertFilter, alertPatch] = alertRepo.update.mock.calls[0];
      expect(alertFilter).toEqual({ id: expect.any(Object) });
      expect(alertPatch).toEqual({ caseId: 'case-9', status: 'triaged' });
      expect(audit.logEvent).toHaveBeenCalledWith({
        actorId: 'admin-1',
        route: 'POST /admin/aml/cases',
        statusCode: 201,
        requestDetails: {
          caseNumber: 'AML-CASE-2026-000042',
          alertIds: ['alert-1'],
        },
      });
    });

    it('returns the persisted case', async () => {
      const persisted = makeCase({ id: 'case-1' });
      caseRepo.findOne.mockResolvedValue(persisted);

      await expect(service.createCase({})).resolves.toBe(persisted);
    });

    it('creates a standalone investigation when no alerts are given', async () => {
      await service.createCase({});

      expect(alertRepo.find).not.toHaveBeenCalled();
      expect(alertRepo.update).not.toHaveBeenCalled();

      const created = createdCaseInput(caseRepo);
      expect(created.title).toBe('AML investigation');
      expect(created.summary).toBe('');
      expect(created.priority).toBe('MEDIUM');
      expect(created.subjectUserId).toBeNull();
      expect(created.alertIds).toEqual([]);
      expect(created.riskScore).toBe(0);
      expect(created.exposureUsd).toBe(0);
    });

    it('lets the caller override the derived fields', async () => {
      alertRepo.find.mockResolvedValue([makeAlert({ severity: 'LOW' })]);

      await service.createCase({
        alertIds: ['alert-1'],
        title: 'Manual title',
        summary: 'Manual summary',
        subjectUserId: 'subject-1',
        priority: 'CRITICAL',
      });

      const created = createdCaseInput(caseRepo);
      expect(created.title).toBe('Manual title');
      expect(created.summary).toBe('Manual summary');
      expect(created.subjectUserId).toBe('subject-1');
      expect(created.priority).toBe('CRITICAL');
    });

    it('drops empty alert selections and unknown evidence shapes', async () => {
      alertRepo.find.mockResolvedValue([
        makeAlert({ id: 'alert-1', evidence: null as any }),
      ]);

      await service.createCase({ alertIds: ['alert-1'] });

      expect(createdCaseInput(caseRepo).subjectSnapshot.flowIds).toEqual([]);
    });

    it('throws when one of the requested alerts does not exist', async () => {
      alertRepo.find.mockResolvedValue([makeAlert({ id: 'alert-1' })]);

      await expect(
        service.createCase({ alertIds: ['alert-1', 'alert-2'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses alerts that already belong to a case', async () => {
      alertRepo.find.mockResolvedValue([
        makeAlert({ id: 'alert-1', caseId: 'case-2' }),
      ]);

      await expect(
        service.createCase({ alertIds: ['alert-1'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('attachAlerts', () => {
    it('links the alerts and recomputes risk score and exposure', async () => {
      caseRepo.findOne.mockResolvedValue(
        makeCase({
          alertIds: ['alert-1'],
          riskScore: 50,
          exposureUsd: 1000,
          timeline: [],
        }),
      );
      alertRepo.find.mockResolvedValue([
        makeAlert({ id: 'alert-2', riskScore: 80, amountUsd: 2000 }),
        makeAlert({ id: 'alert-3', riskScore: 70, amountUsd: 500 }),
      ]);

      await service.attachAlerts('case-1', ['alert-2', 'alert-3'], 'admin-1');

      expect(alertRepo.update.mock.calls[0][1]).toEqual({
        caseId: 'case-1',
        status: 'triaged',
      });

      const saved = caseRepo.save.mock.calls[0][0];
      expect(saved.alertIds).toEqual(['alert-1', 'alert-2', 'alert-3']);
      expect(saved.riskScore).toBe(80);
      expect(saved.exposureUsd).toBe(3500);
      expect(timelineActions(saved)).toEqual(['alerts_attached']);
      expect(saved.timeline[0].detail).toEqual({
        alertIds: ['alert-2', 'alert-3'],
      });
    });

    it('does not lower the score and de-duplicates the alert list', async () => {
      caseRepo.findOne.mockResolvedValue(
        makeCase({ alertIds: ['alert-1'], riskScore: 95, exposureUsd: 10 }),
      );
      alertRepo.find.mockResolvedValue([
        makeAlert({
          id: 'alert-1',
          caseId: 'case-1',
          riskScore: 20,
          amountUsd: null,
        }),
        makeAlert({ id: 'alert-2', riskScore: 40, amountUsd: null }),
      ]);

      await service.attachAlerts('case-1', ['alert-1', 'alert-2']);

      const saved = caseRepo.save.mock.calls[0][0];
      expect(saved.alertIds).toEqual(['alert-1', 'alert-2']);
      expect(saved.riskScore).toBe(95);
      expect(saved.exposureUsd).toBe(10);
    });

    it('tolerates a case stored without a timeline', async () => {
      caseRepo.findOne.mockResolvedValue(
        makeCase({ timeline: null as unknown as AmlCaseTimelineEntry[] }),
      );
      alertRepo.find.mockResolvedValue([makeAlert({ id: 'alert-1' })]);

      await service.attachAlerts('case-1', ['alert-1']);

      expect(timelineActions(caseRepo.save.mock.calls[0][0])).toEqual([
        'alerts_attached',
      ]);
    });

    it('throws when an alert is missing', async () => {
      caseRepo.findOne.mockResolvedValue(makeCase());
      alertRepo.find.mockResolvedValue([]);

      await expect(service.attachAlerts('case-1', ['alert-x'])).rejects.toThrow(
        NotFoundException,
      );
      expect(alertRepo.update).not.toHaveBeenCalled();
    });

    it('refuses alerts that belong to another case', async () => {
      caseRepo.findOne.mockResolvedValue(makeCase());
      alertRepo.find.mockResolvedValue([
        makeAlert({ id: 'alert-1', caseId: 'other-case' }),
      ]);

      await expect(service.attachAlerts('case-1', ['alert-1'])).rejects.toThrow(
        'One or more alerts belong to another case',
      );
    });

    it('throws when the case does not exist', async () => {
      caseRepo.findOne.mockResolvedValue(null);

      await expect(
        service.attachAlerts('missing', ['alert-1']),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateCase', () => {
    it('refuses to edit a closed case', async () => {
      caseRepo.findOne.mockResolvedValue(makeCase({ status: 'closed' }));

      await expect(
        service.updateCase('case-1', { status: 'open' }),
      ).rejects.toThrow(
        'Closed cases cannot be edited; reopen a new case instead',
      );
      expect(caseRepo.save).not.toHaveBeenCalled();
    });

    it('records a timeline entry per changed field', async () => {
      caseRepo.findOne.mockResolvedValue(
        makeCase({
          timeline: [
            { at: 'earlier', action: 'case_opened', actorId: null, detail: {} },
          ],
        }),
      );

      await service.updateCase(
        'case-1',
        {
          status: 'escalated',
          priority: 'HIGH',
          assignedTo: 'analyst-1',
          notes: 'needs a SAR',
        },
        'admin-1',
      );

      const saved = caseRepo.save.mock.calls[0][0];
      expect(saved.status).toBe('escalated');
      expect(saved.priority).toBe('HIGH');
      expect(saved.assignedTo).toBe('analyst-1');
      expect(saved.notes).toBe('needs a SAR');
      expect(timelineActions(saved)).toEqual([
        'case_opened',
        'status_escalated',
        'priority_changed',
        'assigned',
        'note_added',
      ]);
      expect(saved.timeline[3].detail).toEqual({ assignedTo: 'analyst-1' });
      expect(saved.timeline[4].detail).toEqual({ length: 11 });
      expect(
        saved.timeline
          .slice(1)
          .every((entry: AmlCaseTimelineEntry) => entry.actorId === 'admin-1'),
      ).toBe(true);
    });

    it('re-derives the due date when the priority changes', async () => {
      caseRepo.findOne.mockResolvedValue(
        makeCase({
          priority: 'LOW',
          dueAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const before = Date.now();
      await service.updateCase('case-1', { priority: 'CRITICAL' });

      const dueAt = caseRepo.save.mock.calls[0][0].dueAt as Date;
      expect(dueAt.getTime()).toBeGreaterThanOrEqual(before + 3 * 86_400_000);
    });

    it('leaves the case untouched for an empty update', async () => {
      caseRepo.findOne.mockResolvedValue(makeCase({ timeline: [] }));

      await service.updateCase('case-1', {});

      const saved = caseRepo.save.mock.calls[0][0];
      expect(saved.timeline).toHaveLength(0);
      expect(saved.status).toBe('open');
    });

    it('records a null actor when nobody is supplied', async () => {
      caseRepo.findOne.mockResolvedValue(makeCase());

      await service.updateCase('case-1', { status: 'in_review' });

      expect(caseRepo.save.mock.calls[0][0].timeline[0].actorId).toBeNull();
    });
  });

  describe('closeCase', () => {
    it('stamps the disposition, the closing time and the timeline', async () => {
      caseRepo.findOne.mockResolvedValue(
        makeCase({ alertIds: [], notes: 'earlier note' }),
      );

      await service.closeCase(
        'case-1',
        { disposition: 'sar_filed' },
        'admin-1',
      );

      const saved = caseRepo.save.mock.calls[0][0];
      expect(saved.status).toBe('closed');
      expect(saved.disposition).toBe('sar_filed');
      expect(saved.closedAt).toBeInstanceOf(Date);
      expect(saved.notes).toBe('earlier note');
      expect(timelineActions(saved)).toEqual(['case_closed']);
      expect(saved.timeline[0].detail).toEqual({ disposition: 'sar_filed' });
      expect(audit.logEvent).toHaveBeenCalledWith({
        actorId: 'admin-1',
        route: 'POST /admin/aml/cases/close',
        statusCode: 200,
        requestDetails: expect.objectContaining({ disposition: 'sar_filed' }),
      });
    });

    it('keeps the closing note from the dto when provided', async () => {
      caseRepo.findOne.mockResolvedValue(
        makeCase({ alertIds: [], notes: null }),
      );

      await service.closeCase('case-1', {
        disposition: 'no_action',
        notes: 'closed with a reason',
      });

      expect(caseRepo.save.mock.calls[0][0].notes).toBe('closed with a reason');
    });

    it('triages every open alert on the case', async () => {
      caseRepo.findOne.mockResolvedValue(
        makeCase({ alertIds: ['alert-1', 'alert-2'] }),
      );
      alertRepo.find.mockResolvedValue([
        makeAlert({ id: 'alert-1' }),
        makeAlert({ id: 'alert-2' }),
      ]);
      alertRepo.findOne.mockImplementation(
        async (options: { where: { id: string } }) =>
          makeAlert({ id: options.where.id }),
      );
      ruleRepo.findOne.mockImplementation(async () => makeRule());

      await service.closeCase(
        'case-1',
        { disposition: 'false_positive' },
        'admin-1',
      );

      expect(alertRepo.save).toHaveBeenCalledTimes(2);
      expect(feedbackRepo.save).toHaveBeenCalledTimes(2);
      expect(ruleRepo.save).toHaveBeenCalledTimes(2);
      expect(alertRepo.save.mock.calls[0][0].status).toBe('false_positive');
    });

    it('files a case-level feedback row when nothing is left to triage', async () => {
      caseRepo.findOne.mockResolvedValue(
        makeCase({
          alertIds: ['alert-1'],
          status: 'escalated',
        }),
      );
      alertRepo.find.mockResolvedValue([
        makeAlert({ id: 'alert-1', reviewedAt: new Date('2026-01-01') }),
      ]);

      await service.closeCase(
        'case-1',
        { disposition: 'no_action' },
        'admin-1',
      );

      expect(alertRepo.findOne).not.toHaveBeenCalled();
      expect(ruleRepo.findOne).not.toHaveBeenCalled();
      expect(feedbackRepo.save).toHaveBeenCalledTimes(1);
      expect(feedbackRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleCode: 'CASE',
          caseId: 'case-1',
          alertId: null,
          ruleId: null,
          patternType: '',
          disposition: 'no_action',
          recordedBy: 'admin-1',
        }),
      );
    });

    it('refuses to close a case twice', async () => {
      caseRepo.findOne.mockResolvedValue(makeCase({ status: 'closed' }));

      await expect(
        service.closeCase('case-1', { disposition: 'no_action' }),
      ).rejects.toThrow('Case is already closed');
    });

    it('throws when the case does not exist', async () => {
      caseRepo.findOne.mockResolvedValue(null);

      await expect(
        service.closeCase('missing', { disposition: 'no_action' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('triageAlert', () => {
    const statusByDisposition: Array<[AmlDisposition, AmlAlertStatus]> = [
      ['false_positive', 'false_positive'],
      ['sar_filed', 'escalated'],
      ['no_action', 'dismissed'],
      ['referred_to_authority', 'escalated'],
      ['account_restricted', 'escalated'],
    ];

    for (const [disposition, expectedStatus] of statusByDisposition) {
      it(`maps ${disposition} to the ${expectedStatus} alert status`, async () => {
        alertRepo.findOne.mockResolvedValue(makeAlert());
        ruleRepo.findOne.mockResolvedValue(null);

        const saved = await service.triageAlert(
          'alert-1',
          disposition,
          'because',
          'admin-1',
        );

        expect(saved.status).toBe(expectedStatus);
        expect(saved.reviewedBy).toBe('admin-1');
        expect(saved.reviewedAt).toBeInstanceOf(Date);
        expect(feedbackRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ disposition, reason: 'because' }),
        );
      });
    }

    it('throws when the alert is unknown', async () => {
      alertRepo.findOne.mockResolvedValue(null);

      await expect(
        service.triageAlert('missing', 'no_action', null),
      ).rejects.toThrow('Alert missing not found');
    });

    it('rejects a second triage of the same alert', async () => {
      alertRepo.findOne.mockResolvedValue(
        makeAlert({ reviewedAt: new Date('2026-01-01') }),
      );

      await expect(
        service.triageAlert('alert-1', 'no_action', null),
      ).rejects.toThrow('Alert has already been triaged');
      expect(feedbackRepo.save).not.toHaveBeenCalled();
    });

    it('increments the false positive counter and re-tunes the rule', async () => {
      alertRepo.findOne.mockResolvedValue(makeAlert());
      ruleRepo.findOne.mockResolvedValue(
        makeRule({ sensitivityMultiplier: 1 }),
      );

      await service.triageAlert(
        'alert-1',
        'false_positive',
        'noise',
        'admin-1',
      );

      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          falsePositiveCount: 1,
          truePositiveCount: 0,
          sensitivityMultiplier: sensitivityFromDisposition(1, 0),
        }),
      );
      expect(feedbackRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          alertId: 'alert-1',
          ruleId: 'rule-1',
          ruleCode: 'AML-MON-STRUCT-001',
          patternType: 'STRUCTURING',
          disposition: 'false_positive',
          recordedBy: 'admin-1',
          reason: 'noise',
          sensitivityBefore: 1,
          sensitivityAfter: 1,
          caseId: null,
        }),
      );
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('counts every other disposition as a true positive', async () => {
      alertRepo.findOne.mockResolvedValue(makeAlert());
      ruleRepo.findOne.mockResolvedValue(
        makeRule({ truePositiveCount: 6, sensitivityMultiplier: 1 }),
      );

      await service.triageAlert('alert-1', 'sar_filed', null, undefined);

      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          falsePositiveCount: 0,
          truePositiveCount: 7,
        }),
      );
      expect(feedbackRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ recordedBy: null, reason: null }),
      );
    });

    it('logs and persists the multiplier when the tuning crosses a band', async () => {
      alertRepo.findOne.mockResolvedValue(makeAlert());
      ruleRepo.findOne.mockResolvedValue(
        makeRule({ falsePositiveCount: 4, sensitivityMultiplier: 1 }),
      );

      await service.triageAlert('alert-1', 'false_positive', null);

      expect(ruleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          sensitivityMultiplier: 0.4,
          falsePositiveCount: 5,
        }),
      );
      expect(logger.log).toHaveBeenCalledWith(
        'Rule AML-MON-STRUCT-001 sensitivity 1 -> 0.4',
      );
      expect(feedbackRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sensitivityBefore: 1,
          sensitivityAfter: 0.4,
        }),
      );
    });

    it('still records feedback when the rule no longer exists', async () => {
      alertRepo.findOne.mockResolvedValue(makeAlert());
      ruleRepo.findOne.mockResolvedValue(null);

      await service.triageAlert('alert-1', 'no_action', null);

      expect(ruleRepo.save).not.toHaveBeenCalled();
      expect(feedbackRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sensitivityBefore: null,
          sensitivityAfter: null,
        }),
      );
    });

    it('skips rule tuning for an alert without a rule reference', async () => {
      alertRepo.findOne.mockResolvedValue(
        makeAlert({ ruleId: null, patternType: 'PEP_MATCH' as any }),
      );

      await service.triageAlert('alert-1', 'no_action', null);

      expect(ruleRepo.findOne).not.toHaveBeenCalled();
      expect(feedbackRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: null,
          patternType: 'PEP_MATCH',
          sensitivityBefore: null,
        }),
      );
    });
  });

  describe('listAlerts', () => {
    it('clamps the limit to the 1-200 window', async () => {
      alertRepo.findAndCount.mockResolvedValue([[makeAlert()], 1]);

      await service.listAlerts({ limit: 5000 });
      expect(alertRepo.findAndCount).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 200 }),
      );

      await service.listAlerts({ limit: -3 });
      expect(alertRepo.findAndCount).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 1 }),
      );

      await service.listAlerts({});
      expect(alertRepo.findAndCount).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('offsets by the requested page and never negative', async () => {
      await service.listAlerts({ limit: 10, page: 3 });
      expect(alertRepo.findAndCount).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 30, take: 10 }),
      );

      await service.listAlerts({ limit: 10, page: -2 });
      expect(alertRepo.findAndCount).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('filters on the supplied columns and sorts by risk', async () => {
      await service.listAlerts({
        status: 'pending',
        userId: 'user-1',
        patternType: 'STRUCTURING',
        ruleCode: 'AML-MON-STRUCT-001',
      });

      expect(alertRepo.findAndCount).toHaveBeenCalledWith({
        where: {
          status: 'pending',
          userId: 'user-1',
          patternType: 'STRUCTURING',
          ruleCode: 'AML-MON-STRUCT-001',
        },
        order: { riskScore: 'DESC', createdAt: 'DESC' },
        take: 50,
        skip: 0,
      });
    });

    it('returns the queue and the total count', async () => {
      const alert = makeAlert();
      alertRepo.findAndCount.mockResolvedValue([[alert], 7]);

      await expect(service.listAlerts({})).resolves.toEqual({
        items: [alert],
        total: 7,
      });
    });

    it('uses an empty filter set when nothing is requested', async () => {
      await service.listAlerts({});

      expect(alertRepo.findAndCount.mock.calls[0][0].where).toEqual({});
    });
  });

  describe('listCases', () => {
    it('clamps the page size and applies the filters', async () => {
      caseRepo.findAndCount.mockResolvedValue([[makeCase()], 1]);

      await service.listCases({ status: 'open', limit: 900, page: 2 });

      expect(caseRepo.findAndCount).toHaveBeenCalledWith({
        where: { status: 'open' },
        order: { createdAt: 'DESC' },
        take: 200,
        skip: 400,
      });
    });

    it('filters on assignee and subject', async () => {
      await service.listCases({
        assignedTo: 'analyst-1',
        subjectUserId: 'user-1',
      });

      expect(caseRepo.findAndCount.mock.calls[0][0].where).toEqual({
        assignedTo: 'analyst-1',
        subjectUserId: 'user-1',
      });
    });

    it('defaults to a 50 item page', async () => {
      await service.listCases({});

      expect(caseRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0, where: {} }),
      );
    });
  });

  describe('overdueCases', () => {
    it('selects non-closed cases past their due date', async () => {
      const now = new Date('2026-03-01T00:00:00.000Z');
      caseRepo.qb.getMany.mockResolvedValue([makeCase()]);

      const rows = await service.overdueCases(now);

      expect(caseRepo.qb.where).toHaveBeenCalledWith('case.status <> :closed', {
        closed: 'closed',
      });
      expect(caseRepo.qb.andWhere).toHaveBeenCalledWith(
        'case.due_at IS NOT NULL',
      );
      expect(caseRepo.qb.andWhere).toHaveBeenCalledWith('case.due_at < :now', {
        now,
      });
      expect(caseRepo.qb.orderBy).toHaveBeenCalledWith('case.due_at', 'ASC');
      expect(rows).toHaveLength(1);
    });

    it('compares against the current time by default', async () => {
      await service.overdueCases();

      const args = caseRepo.qb.andWhere.mock.calls[1][1];
      expect(args.now).toBeInstanceOf(Date);
    });
  });

  describe('summary', () => {
    it('rolls up case statuses, overdue count and the false positive rate', async () => {
      caseRepo.qb.getRawMany.mockResolvedValue([
        { status: 'open', count: '3' },
        { status: 'escalated', count: '2' },
        { status: 'closed', count: '8' },
      ]);
      feedbackRepo.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
      caseRepo.qb.getMany.mockResolvedValue([makeCase(), makeCase()]);

      const summary = await service.summary();

      expect(summary).toEqual({
        open: 3,
        inReview: 0,
        escalated: 2,
        closed: 8,
        overdue: 2,
        falsePositiveRate: 0.4,
      });
      expect(caseRepo.qb.groupBy).toHaveBeenCalledWith('case.status');
      expect(feedbackRepo.count).toHaveBeenCalledWith({
        where: { disposition: 'false_positive' },
      });
    });

    it('reports an empty dashboard when nothing has been recorded', async () => {
      caseRepo.qb.getRawMany.mockResolvedValue([]);
      feedbackRepo.count.mockResolvedValue(0);
      caseRepo.qb.getMany.mockResolvedValue([]);

      await expect(service.summary()).resolves.toEqual({
        open: 0,
        inReview: 0,
        escalated: 0,
        closed: 0,
        overdue: 0,
        falsePositiveRate: 0,
      });
    });

    it('reads the in_review status from the grouped rows', async () => {
      caseRepo.qb.getRawMany.mockResolvedValue([
        { status: 'in_review', count: '5' },
      ]);

      const summary = await service.summary();

      expect(summary.inReview).toBe(5);
    });
  });

  describe('getCase', () => {
    it('throws for an unknown case id', async () => {
      caseRepo.findOne.mockResolvedValue(null);

      await expect(service.getCase('nope')).rejects.toThrow(
        'Case nope not found',
      );
    });

    it('returns the stored case', async () => {
      const target = makeCase();
      caseRepo.findOne.mockResolvedValue(target);

      await expect(service.getCase('case-1')).resolves.toBe(target);
    });
  });
});
