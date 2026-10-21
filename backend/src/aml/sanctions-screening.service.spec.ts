import { SanctionsScreeningService } from './sanctions-screening.service';
import { SanctionsListEntry } from './entities/sanctions-list-entry.entity';
import { ScreenSubjectDto } from './dto/aml-monitoring.dto';

const IVAN = {
  id: 'entry-1',
  listSource: 'OFAC',
  entryType: 'PERSON',
  name: 'Ivan Petrov Setrov',
  normalisedName: 'ivan petrov setrov',
  aliases: [],
  country: 'RU',
  idNumbers: [],
  dateOfBirth: '1960-04',
  isPep: false,
  programme: 'RUSSIA-EO14024',
  listVersion: '2026-10',
} as unknown as Partial<SanctionsListEntry>;

const PEP: Partial<SanctionsListEntry> = {
  ...IVAN,
  id: 'entry-2',
  name: 'Amina Diallo',
  normalisedName: 'amina diallo',
  dateOfBirth: null,
  isPep: true,
  pepRole: 'Minister of Agriculture',
};

function makeEntityRepo(id: string): any {
  return {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    create: jest.fn((payload: any) => ({ id, ...payload })),
    save: jest.fn(async (entity: any) => entity),
  };
}

function makeConfig(values: Record<string, string> = {}): any {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  };
}

function makeFixtures(
  options: {
    config?: Record<string, string>;
    entries?: Partial<SanctionsListEntry>[];
    existingAlert?: any;
    walletScreener?: { isAddressSanctioned: jest.Mock };
  } = {},
) {
  const userRepository = makeEntityRepo('user-1');
  const complianceAlertRepository = makeEntityRepo('compliance-1');
  const alertRepository = makeEntityRepo('alert-1');
  const resultRepository = makeEntityRepo('result-1');
  alertRepository.findOne = jest.fn(async () => options.existingAlert ?? null);

  const sanctionsList = {
    candidatesForName: jest.fn(async () => options.entries ?? []),
    findByIdNumber: jest.fn(async () => null),
  };
  const caseService = {
    createCase: jest.fn(async () => ({
      id: 'case-1',
      caseNumber: 'CASE-0001',
    })),
  };
  const auditService = { logEvent: jest.fn(async () => undefined) };
  const walletScreener = options.walletScreener;

  const service = new SanctionsScreeningService(
    userRepository as any,
    complianceAlertRepository as any,
    alertRepository as any,
    resultRepository as any,
    sanctionsList as any,
    caseService as any,
    makeConfig(options.config) as any,
    auditService as any,
    walletScreener as any,
  );

  return {
    service,
    userRepository,
    complianceAlertRepository,
    alertRepository,
    resultRepository,
    sanctionsList,
    caseService,
    auditService,
  };
}

describe('SanctionsScreeningService', () => {
  describe('bestNameHit', () => {
    it('keeps the strongest candidate and ignores non-matches', async () => {
      const f = makeFixtures({
        entries: [
          {
            id: 'weak',
            entryType: 'PERSON',
            name: 'Ivan Something Else',
            aliases: [],
          },
          { id: 'strong', entryType: 'PERSON', name: 'Ivan Petrov Setrov' },
          {
            id: 'none',
            entryType: 'PERSON',
            name: 'Zara Nguyen',
            aliases: [],
          },
        ],
      });

      const hit = await f.service.bestNameHit('Ivan Petrov Setrov');

      expect(hit?.entry.id).toBe('strong');
      expect(hit?.score).toBe(100);
      expect(hit?.reasons[0]).toContain('Exact person match');
    });

    it('grades partial dates of birth into the score and the reasons', async () => {
      const f = makeFixtures({ entries: [IVAN] });

      const withoutDob = await f.service.bestNameHit(
        'Ivan Petrov Nobody',
        undefined,
      );
      const withDob = await f.service.bestNameHit(
        'Ivan Petrov Nobody',
        '1960-04',
      );

      expect(withoutDob?.score).toBe(70);
      expect(withDob?.score).toBe(78);
      expect(withDob?.reasons).toContain('date of birth agrees (+8)');
    });

    it('returns null when the list has no candidate', async () => {
      const f = makeFixtures({ entries: [] });
      await expect(f.service.bestNameHit('Nobody Here')).resolves.toBeNull();
    });
  });

  describe('screenSubject', () => {
    it('records a clear result without alerting', async () => {
      const f = makeFixtures({ entries: [] });

      const outcome = await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-9',
        name: 'Grace Adeyemi',
      } as ScreenSubjectDto);

      expect(outcome.decision).toBe('clear');
      expect(outcome.score).toBe(0);
      expect(outcome.alertId).toBeNull();
      expect(outcome.caseNumber).toBeNull();
      expect(outcome.resultId).toBe('result-1');
      expect(f.alertRepository.create).not.toHaveBeenCalled();
      expect(f.resultRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'clear', score: 0 }),
      );
    });

    it('screens a stored user by their full name when the dto omits one', async () => {
      const f = makeFixtures({ entries: [IVAN] });
      f.userRepository.find = jest.fn(async () => []);
      f.userRepository.findOne = jest.fn(async () => ({
        id: 'user-9',
        fullName: 'Ivan Petrov Setrov',
        walletAddress: null,
        country: 'NG',
      }));

      const outcome = await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-9',
      } as ScreenSubjectDto);

      expect(f.sanctionsList.candidatesForName).toHaveBeenCalledWith(
        'Ivan Petrov Setrov',
      );
      expect(outcome.decision).toBe('match');
      expect(outcome.matchedName).toBe('Ivan Petrov Setrov');
    });

    it('raises a critical sanctions alert and opens a case on a match', async () => {
      const f = makeFixtures({ entries: [IVAN] });

      const outcome = await f.service.screenSubject({
        subjectType: 'transaction',
        subjectId: 'subject-1',
        name: 'Ivan Petrov Setrov',
      } as ScreenSubjectDto);

      expect(outcome.decision).toBe('match');
      expect(outcome.alertId).toBe('alert-1');
      expect(outcome.caseNumber).toBe('CASE-0001');

      const alert = f.alertRepository.create.mock.calls[0][0];
      expect(alert).toEqual(
        expect.objectContaining({
          patternType: 'SANCTIONS_MATCH',
          ruleId: null,
          severity: 'CRITICAL',
          action: 'REJECT',
          riskScore: 100,
          status: 'pending',
          dedupeKey: 'SANCTIONS_MATCH:transaction:subject-1:entry-1:100',
        }),
      );
      expect(alert.evidence).toEqual(
        expect.objectContaining({
          matchedEntryId: 'entry-1',
          programme: 'RUSSIA-EO14024',
          listVersion: '2026-10',
        }),
      );
      expect(f.caseService.createCase).toHaveBeenCalledWith({
        alertIds: ['alert-1'],
        subjectUserId: null,
        priority: 'CRITICAL',
      });
    });

    it('mirrors the finding into the existing compliance alerts queue', async () => {
      const f = makeFixtures({ entries: [IVAN] });

      await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-1',
        name: 'Ivan Petrov Setrov',
      } as ScreenSubjectDto);

      expect(f.complianceAlertRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'sanctions_match',
          riskScore: 100,
          source: 'ofac_screening',
          status: 'pending',
        }),
      );
    });

    it('keeps a borderline score in the review band instead of a match', async () => {
      const f = makeFixtures({ entries: [IVAN] });

      const outcome = await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-2',
        name: 'Ivan Petrov Nobody',
        dateOfBirth: '1960-08-11',
      } as ScreenSubjectDto);

      expect(outcome.decision).toBe('review');
      expect(outcome.score).toBe(74);
      const alert = f.alertRepository.create.mock.calls[0][0];
      expect(alert.severity).toBe('HIGH');
      expect(alert.riskScore).toBe(74);
    });

    it('applies configured thresholds', async () => {
      const f = makeFixtures({
        entries: [IVAN],
        config: {
          AML_SANCTIONS_MATCH_THRESHOLD: '95',
          AML_SANCTIONS_REVIEW_THRESHOLD: '80',
        },
      });

      const outcome = await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-3',
        name: 'Ivan Setrov',
      } as ScreenSubjectDto);

      // 90 is a match at the default ceiling but only a review at 95.
      expect(outcome.score).toBe(90);
      expect(outcome.decision).toBe('review');
      expect(f.alertRepository.create.mock.calls[0][0].riskScore).toBe(90);
    });

    it('quotes the configured review threshold when nothing is close', async () => {
      const f = makeFixtures({
        entries: [
          { ...IVAN, name: 'Zara Nguyen', normalisedName: 'zara nguyen' },
        ],
        config: { AML_SANCTIONS_REVIEW_THRESHOLD: '80' },
      });

      const outcome = await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-3b',
        name: 'Ivan Petrov Setrov',
      } as ScreenSubjectDto);

      expect(outcome.decision).toBe('clear');
      expect(outcome.reasons[0]).toContain('within 80 points');
      expect(f.alertRepository.create).not.toHaveBeenCalled();
    });

    it('does not alert when raiseAlert is false', async () => {
      const f = makeFixtures({ entries: [IVAN] });

      const outcome = await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-4',
        name: 'Ivan Petrov Setrov',
        raiseAlert: false,
      } as ScreenSubjectDto);

      expect(outcome.decision).toBe('match');
      expect(outcome.alertId).toBeNull();
      expect(f.alertRepository.create).not.toHaveBeenCalled();
      expect(f.resultRepository.create).toHaveBeenCalled();
    });

    it('reuses the alert already recorded for the same subject and score', async () => {
      const f = makeFixtures({
        entries: [IVAN],
        existingAlert: { id: 'alert-old', caseId: 'case-old' },
      });

      const outcome = await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-5',
        name: 'Ivan Petrov Setrov',
      } as ScreenSubjectDto);

      expect(outcome.alertId).toBe('alert-old');
      expect(outcome.caseNumber).toBe('case-old');
      expect(f.alertRepository.create).not.toHaveBeenCalled();
      expect(f.caseService.createCase).not.toHaveBeenCalled();
    });

    it('raises a separate, less severe PEP alert for a listed official', async () => {
      const f = makeFixtures({ entries: [PEP] });

      const outcome = await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-6',
        name: 'Amina Diallo',
      } as ScreenSubjectDto);

      const patterns = f.alertRepository.create.mock.calls.map(
        (call: any[]) => call[0].patternType,
      );
      expect(patterns).toEqual(['SANCTIONS_MATCH', 'PEP_MATCH']);
      const pepAlert = f.alertRepository.create.mock.calls[1][0];
      expect(pepAlert.severity).toBe('HIGH');
      expect(pepAlert.matchReason).toContain(
        'Listed as a politically exposed person (Minister of Agriculture)',
      );
      expect(outcome.listSource).toBe('OFAC');
    });

    it('reports a subject with no name and no wallet as clear', async () => {
      const f = makeFixtures();
      f.userRepository.findOne = jest.fn(async () => ({
        id: 'user-7',
        fullName: null,
        walletAddress: null,
      }));

      const outcome = await f.service.screenSubject({
        subjectType: 'user',
        subjectId: 'user-7',
      } as ScreenSubjectDto);

      expect(outcome.decision).toBe('clear');
      expect(outcome.listSource).toBe('INTERNAL');
      expect(outcome.reasons).toEqual(['No name available to screen']);
    });
  });

  describe('screenWallet', () => {
    it('fails closed when the KYT provider is unavailable', async () => {
      const screener = {
        isAddressSanctioned: jest.fn(async () => {
          throw new Error('provider timeout');
        }),
      };
      const f = makeFixtures({ walletScreener: screener });

      const outcome = await f.service.screenWallet('GASHA7Q', {
        id: 'user-8',
        fullName: 'Ada Okoye',
        walletAddress: 'GASHA7Q',
      } as any);

      expect(outcome.decision).toBe('review');
      expect(outcome.score).toBe(50);
      expect(outcome.reasons).toEqual([
        'Provider unavailable: provider timeout',
      ]);
      expect(f.resultRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ listSource: 'KYT', decision: 'review' }),
      );
      expect(f.alertRepository.create).toHaveBeenCalled();
    });

    it('matches a sanctioned address and opens a case', async () => {
      const screener = { isAddressSanctioned: jest.fn(async () => true) };
      const f = makeFixtures({ walletScreener: screener });

      const outcome = await f.service.screenWallet('GASANC1', null);

      expect(outcome.decision).toBe('match');
      expect(outcome.score).toBe(100);
      expect(outcome.caseNumber).toBe('CASE-0001');
      expect(screener.isAddressSanctioned).toHaveBeenCalledWith('GASANC1');
    });

    it('clears an unflagged address', async () => {
      const screener = { isAddressSanctioned: jest.fn(async () => false) };
      const f = makeFixtures({ walletScreener: screener });

      const outcome = await f.service.screenWallet('GASOK1', null);

      expect(outcome.decision).toBe('clear');
      expect(outcome.reasons).toEqual([
        'Address not flagged by the KYT provider',
      ]);
      expect(f.alertRepository.create).not.toHaveBeenCalled();
    });

    it('treats a missing provider as no signal rather than an error', async () => {
      const f = makeFixtures();

      const outcome = await f.service.screenWallet('GASOK1', null);

      expect(outcome.decision).toBe('clear');
      expect(outcome.score).toBe(0);
    });

    it('routes a wallet subject away from name screening', async () => {
      const screener = { isAddressSanctioned: jest.fn(async () => false) };
      const f = makeFixtures({ walletScreener: screener });

      const outcome = await f.service.screenSubject({
        subjectType: 'wallet',
        subjectId: 'GASOK1',
      } as ScreenSubjectDto);

      expect(outcome.subjectType).toBe('wallet');
      expect(f.sanctionsList.candidatesForName).not.toHaveBeenCalled();
    });
  });

  describe('rescreenVerifiedUsers', () => {
    it('screens each batch and tallies the decisions', async () => {
      const f = makeFixtures({ entries: [IVAN] });
      const firstBatch = [
        { id: 'u1', fullName: 'Ivan Petrov Setrov', country: 'RU' },
        { id: 'u2', fullName: 'Grace Adeyemi', country: 'NG' },
        { id: 'u3', fullName: null, country: 'NG' },
      ];
      f.userRepository.find = jest
        .fn()
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce([]);

      const summary = await f.service.rescreenVerifiedUsers(3, 100);

      expect(summary).toEqual({
        screened: 2,
        matches: 1,
        reviews: 0,
        cleared: 1,
      });
      expect(f.userRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3, skip: 0 }),
      );
      expect(f.auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ route: 'AML_SANCTIONS_RESCREEN' }),
      );
    });

    it('stops at the user ceiling', async () => {
      const f = makeFixtures({ entries: [] });
      const users = Array.from({ length: 2 }, (_, index) => ({
        id: `u${index}`,
        fullName: 'Grace Adeyemi',
        country: 'NG',
      }));
      f.userRepository.find = jest.fn(async () => users);

      const summary = await f.service.rescreenVerifiedUsers(2, 2);

      expect(summary.screened).toBe(2);
      expect(f.userRepository.find).toHaveBeenCalledTimes(1);
    });
  });
});
