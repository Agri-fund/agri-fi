import { AmlMonitoringCronService } from './aml-monitoring-cron.service';
import type { SweepResult } from './transaction-monitoring.service';

interface SubmissionStub {
  id: string;
  channel: string;
  submissionNumber: string;
}

function sweepResult(overrides: Partial<SweepResult> = {}): SweepResult {
  const result: SweepResult = {
    runId: 'run-1',
    windowStart: new Date('2026-01-01T00:00:00.000Z'),
    windowEnd: new Date('2026-01-01T01:00:00.000Z'),
    usersEvaluated: 3,
    flowsEvaluated: 10,
    rulesApplied: 7,
    alertsRaised: 0,
    alertsSkippedDuplicate: 0,
    alertsBelowThreshold: 0,
    casesOpened: [],
    status: 'completed',
  };
  return Object.assign(result, overrides);
}

function submission(
  id: string,
  channel: string,
  submissionNumber = `SUB-${id}`,
): SubmissionStub {
  return { id, channel, submissionNumber };
}

describe('AmlMonitoringCronService', () => {
  let rulesService: { ensureDefaults: jest.Mock };
  let monitoringService: { isEnabled: boolean; runSweep: jest.Mock };
  let screeningService: { rescreenVerifiedUsers: jest.Mock };
  let reportingService: { dueForRetry: jest.Mock; retry: jest.Mock };
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let service: AmlMonitoringCronService;

  beforeEach(() => {
    rulesService = {
      ensureDefaults: jest.fn().mockResolvedValue({ created: [] }),
    };
    monitoringService = {
      isEnabled: true,
      runSweep: jest.fn().mockResolvedValue(sweepResult()),
    };
    screeningService = {
      rescreenVerifiedUsers: jest
        .fn()
        .mockResolvedValue({ screened: 5, matches: 1, reviews: 2, cleared: 4 }),
    };
    reportingService = {
      dueForRetry: jest.fn().mockResolvedValue([]),
      retry: jest.fn().mockResolvedValue({ status: 'accepted' }),
    };
    service = new AmlMonitoringCronService(
      rulesService as any,
      monitoringService as any,
      screeningService as any,
      reportingService as any,
    );
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    (service as any).logger = logger;
  });

  describe('runHourlySweep', () => {
    it('does nothing while monitoring is disabled', async () => {
      monitoringService.isEnabled = false;

      await service.runHourlySweep();

      expect(rulesService.ensureDefaults).not.toHaveBeenCalled();
      expect(monitoringService.runSweep).not.toHaveBeenCalled();
    });

    it('seeds the shipped rules before sweeping the last hour', async () => {
      const order: string[] = [];
      rulesService.ensureDefaults.mockImplementation(async () => {
        order.push('seed');
        return { created: [] };
      });
      monitoringService.runSweep.mockImplementation(async () => {
        order.push('sweep');
        return sweepResult();
      });

      await service.runHourlySweep();

      expect(order).toEqual(['seed', 'sweep']);
      expect(rulesService.ensureDefaults).toHaveBeenCalledTimes(1);
    });

    it('sweeps a one hour window with the scheduled trigger', async () => {
      const before = Date.now();

      await service.runHourlySweep();

      const options = monitoringService.runSweep.mock.calls[0][0];
      expect(options.trigger).toBe('scheduled');
      expect(options.userId).toBeUndefined();
      expect(options.dryRun).toBeUndefined();

      const spanMs =
        options.windowEnd.getTime() - options.windowStart.getTime();
      expect(spanMs).toBeGreaterThanOrEqual(3_600_000);
      expect(spanMs).toBeLessThan(3_600_000 + 5_000);
      expect(options.windowEnd.getTime()).toBeGreaterThanOrEqual(before);
      expect(options.windowEnd.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('logs the outcome when the sweep raised alerts', async () => {
      monitoringService.runSweep.mockResolvedValue(
        sweepResult({ alertsRaised: 2, flowsEvaluated: 14 }),
      );

      await service.runHourlySweep();

      expect(logger.log).toHaveBeenCalledWith(
        'AML sweep raised 2 alert(s) over 14 flow(s)',
      );
    });

    it('stays quiet when the sweep raised nothing', async () => {
      await service.runHourlySweep();

      expect(logger.log).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('skips a tick that overlaps a sweep still in flight', async () => {
      let finishSweep: (value: SweepResult) => void = () => undefined;
      monitoringService.runSweep.mockImplementationOnce(
        () =>
          new Promise<SweepResult>((resolve) => {
            finishSweep = resolve;
          }),
      );

      const first = service.runHourlySweep();
      await service.runHourlySweep();

      expect(monitoringService.runSweep).toHaveBeenCalledTimes(1);
      expect(rulesService.ensureDefaults).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Previous AML sweep is still running; skipping this tick',
      );

      finishSweep(sweepResult());
      await first;

      await service.runHourlySweep();

      expect(monitoringService.runSweep).toHaveBeenCalledTimes(2);
    });

    it('catches and logs a failing sweep without rethrowing', async () => {
      const failure = new Error('boom');
      monitoringService.runSweep.mockRejectedValueOnce(failure);

      await expect(service.runHourlySweep()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Scheduled AML sweep failed: boom',
        failure.stack,
      );

      await service.runHourlySweep();

      expect(monitoringService.runSweep).toHaveBeenCalledTimes(2);
    });

    it('catches and logs a failure while seeding the rules', async () => {
      rulesService.ensureDefaults.mockRejectedValueOnce(new Error('no seed'));

      await expect(service.runHourlySweep()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Scheduled AML sweep failed: no seed',
        expect.any(String),
      );
      expect(monitoringService.runSweep).not.toHaveBeenCalled();
    });
  });

  describe('runDailyRescreen', () => {
    it('does nothing while monitoring is disabled', async () => {
      monitoringService.isEnabled = false;

      await service.runDailyRescreen();

      expect(screeningService.rescreenVerifiedUsers).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('delegates to the screening service and reports the tally', async () => {
      await service.runDailyRescreen();

      expect(screeningService.rescreenVerifiedUsers).toHaveBeenCalledTimes(1);
      expect(logger.log).toHaveBeenCalledWith(
        'AML re-screen: 5 screened, 1 match(es), 2 review(s)',
      );
    });

    it('swallows a re-screen failure', async () => {
      const failure = new Error('list feed down');
      screeningService.rescreenVerifiedUsers.mockRejectedValueOnce(failure);

      await expect(service.runDailyRescreen()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Scheduled re-screen failed: list feed down',
        failure.stack,
      );
    });
  });

  describe('retryPendingSubmissions', () => {
    it('retries only the api channel filings', async () => {
      reportingService.dueForRetry.mockResolvedValue([
        submission('sub-1', 'api'),
        submission('sub-2', 'manual_portal'),
        submission('sub-3', 'api'),
      ]);

      await service.retryPendingSubmissions();

      expect(reportingService.retry.mock.calls).toEqual([['sub-1'], ['sub-3']]);
    });

    it('stops as soon as it knows nothing is api driven', async () => {
      reportingService.dueForRetry.mockResolvedValue([
        submission('sub-1', 'manual_portal'),
      ]);

      await service.retryPendingSubmissions();

      expect(reportingService.retry).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('handles an empty retry queue', async () => {
      reportingService.dueForRetry.mockResolvedValue([]);

      await service.retryPendingSubmissions();

      expect(reportingService.dueForRetry).toHaveBeenCalledTimes(1);
      expect(reportingService.retry).not.toHaveBeenCalled();
    });

    it('keeps going after an individual retry fails', async () => {
      reportingService.dueForRetry.mockResolvedValue([
        submission('sub-1', 'api'),
        submission('sub-2', 'api'),
        submission('sub-3', 'api'),
      ]);
      reportingService.retry
        .mockResolvedValueOnce({ status: 'accepted' })
        .mockRejectedValueOnce(new Error('fiu timeout'))
        .mockResolvedValueOnce({ status: 'accepted' });

      await service.retryPendingSubmissions();

      expect(reportingService.retry).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenCalledWith(
        'Retry of submission SUB-sub-2 failed: fiu timeout',
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs and swallows a failure of the queue lookup', async () => {
      const failure = new Error('db down');
      reportingService.dueForRetry.mockRejectedValueOnce(failure);

      await expect(service.retryPendingSubmissions()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Submission retry pass failed: db down',
        failure.stack,
      );
      expect(reportingService.retry).not.toHaveBeenCalled();
    });
  });
});
