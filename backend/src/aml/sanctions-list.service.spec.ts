import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { SanctionsListService } from './sanctions-list.service';
import { UpsertSanctionsEntryDto } from './dto/aml-monitoring.dto';

function makeQb(result: unknown = []): any {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    groupBy: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    limit: jest.fn(() => qb),
    getMany: jest.fn(async () => result),
    getOne: jest.fn(async () => (result as any[])[0] ?? null),
    getRawMany: jest.fn(async () => result),
  };
  return qb;
}

function makeRepo(
  options: {
    findOne?: (where: unknown) => Promise<unknown>;
    qb?: unknown;
  } = {},
): any {
  const qb = makeQb(options.qb ?? []);
  return {
    findOne: jest.fn(options.findOne ?? (async () => null)),
    find: jest.fn(async () => []),
    create: jest.fn((payload: unknown) => ({
      id: 'new-id',
      ...(payload as object),
    })),
    save: jest.fn(async (entity: unknown) => entity),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => qb),
    qb,
  };
}

/** Import result carries no per-row data, so assertions stay on the counters. */
function makeService(repo = makeRepo(), managerRepo = repo) {
  const dataSource = {
    transaction: jest.fn(async (cb: (manager: unknown) => Promise<void>) =>
      cb({ getRepository: () => managerRepo }),
    ),
  };
  const service = new SanctionsListService(repo as any, dataSource as any);
  return { service, repo, dataSource };
}

const entry = (overrides: Partial<UpsertSanctionsEntryDto> = {}) =>
  ({
    listSource: 'OFAC',
    name: '  Ivan Setrov  ',
    ...overrides,
  }) as UpsertSanctionsEntryDto;

describe('SanctionsListService', () => {
  describe('upsert', () => {
    it('rejects an entry without a usable name', async () => {
      const { service } = makeService();
      await expect(service.upsert(entry({ name: '   ' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('matches an existing row on list source and external id', async () => {
      const found = { id: 'row-1', name: 'Ivan Setrov' };
      const repo = makeRepo({ findOne: async () => found });
      const { service } = makeService(repo);

      const saved = await service.upsert(
        entry({ externalId: 'sdn-101', name: 'Ivan Petrov Setrov' }),
      );

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { listSource: 'OFAC', externalId: 'sdn-101' },
      });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'row-1', name: 'Ivan Petrov Setrov' }),
      );
      expect(saved).toEqual(expect.objectContaining({ id: 'row-1' }));
    });

    it('falls back to the normalised name when there is no external id', async () => {
      const repo = makeRepo();
      const { service } = makeService(repo);

      await service.upsert(entry());

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { listSource: 'OFAC', normalisedName: 'ivan setrov' },
      });
      expect(repo.create).toHaveBeenCalled();
    });

    it('normalises the stored projection', async () => {
      const repo = makeRepo();
      const { service } = makeService(repo);

      await service.upsert(
        entry({
          country: 'ru',
          aliases: ['Ivan  Setrov', 'Setrov Holdings Ltd'],
          idNumbers: [{ type: 'passport', value: '71-29344' }],
        }),
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ivan Setrov',
          normalisedName: 'ivan setrov',
          country: 'RU',
          aliases: ['ivan setrov', 'setrov holdings'],
          idNumbers: [
            { type: 'PASSPORT', value: '71-29344', normalised: '7129344' },
          ],
          entryType: 'PERSON',
          isPep: false,
          programme: '',
          listVersion: null,
          externalId: null,
        }),
      );
    });

    it('keeps the declared entry type and PEP role', async () => {
      const repo = makeRepo();
      const { service } = makeService(repo);

      await service.upsert(
        entry({
          entryType: 'ENTITY',
          isPep: true,
          pepRole: 'Minister of Agriculture',
          programme: 'RUSSIA-EO14024',
        }),
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entryType: 'ENTITY',
          isPep: true,
          pepRole: 'Minister of Agriculture',
          programme: 'RUSSIA-EO14024',
        }),
      );
    });

    it('overwrites cleared optional fields instead of leaving them undefined', async () => {
      const repo = makeRepo({
        findOne: async () => ({
          id: 'row-1',
          country: 'RU',
          dateOfBirth: '1960-04',
          aliases: ['old'],
        }),
      });
      const { service } = makeService(repo);

      await service.upsert(entry());

      const saved = repo.save.mock.calls[0][0];
      expect(saved.country).toBeNull();
      expect(saved.dateOfBirth).toBeNull();
      expect(saved.aliases).toEqual([]);
    });
  });

  describe('importList', () => {
    it('requires at least one entry', async () => {
      const { service } = makeService();
      await expect(
        service.importList({ listSource: 'OFAC', entries: [] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('counts created, updated and skipped rows in one transaction', async () => {
      const managerRepo = makeRepo({
        findOne: async (args: any) =>
          args?.where?.externalId === 'e-2' ? { id: 'row-2' } : null,
      });
      const { service, dataSource } = makeService(makeRepo(), managerRepo);

      const result = await service.importList({
        listSource: 'EU',
        listVersion: '2026-10',
        entries: [
          { name: 'Alpha One', externalId: 'e-1' },
          { name: 'Alpha Two', externalId: 'e-2' },
          { name: '   ' },
          { name: 'Alpha Three' },
        ],
      } as any);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({
          listSource: 'EU',
          listVersion: '2026-10',
          created: 2,
          updated: 1,
          skipped: 1,
        }),
      );
    });

    it('stamps the list version onto rows that do not carry one', async () => {
      const managerRepo = makeRepo();
      const { service } = makeService(makeRepo(), managerRepo);

      await service.importList({
        listSource: 'UN',
        listVersion: 'v9',
        entries: [
          { name: 'Beta One' },
          { name: 'Beta Two', listVersion: 'v8' },
        ],
      } as any);

      const versions = managerRepo.create.mock.calls.map(
        (call: any[]) => call[0].listVersion,
      );
      expect(versions).toEqual(['v9', 'v8']);
    });

    it('keys new rows on the imported list source, not the entry', async () => {
      const managerRepo = makeRepo();
      const { service } = makeService(makeRepo(), managerRepo);

      await service.importList({
        listSource: 'OFAC',
        entries: [{ name: 'Gamma One', listSource: 'UN' as any }],
      } as any);

      expect(managerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ listSource: 'OFAC' }),
      );
    });

    it('produces a stable checksum over the imported identities', async () => {
      const entries = [
        { name: 'Alpha One', externalId: 'e-1' },
        { name: 'Alpha Two' },
      ];
      const first = await makeService().service.importList({
        listSource: 'OFAC',
        entries,
      } as any);
      const second = await makeService().service.importList({
        listSource: 'OFAC',
        entries,
      } as any);

      const expected = createHash('sha256')
        .update('OFAC:e-1')
        .update('OFAC:name:alpha two')
        .digest('hex');

      expect(first.checksum).toBe(expected);
      expect(second.checksum).toBe(expected);
    });

    it('distinguishes two lists that carry the same rows', async () => {
      const entries = [{ name: 'Alpha One', externalId: 'e-1' }];
      const ofac = await makeService().service.importList({
        listSource: 'OFAC',
        entries,
      } as any);
      const un = await makeService().service.importList({
        listSource: 'UN',
        entries,
      } as any);

      expect(ofac.checksum).not.toBe(un.checksum);
    });

    it('skips nameless entries before they reach the checksum', async () => {
      const withBlank = await makeService().service.importList({
        listSource: 'OFAC',
        entries: [{ name: 'Alpha One' }, { name: '' }],
      } as any);
      const withoutBlank = await makeService().service.importList({
        listSource: 'OFAC',
        entries: [{ name: 'Alpha One' }],
      } as any);

      expect(withBlank.skipped).toBe(1);
      expect(withBlank.checksum).toBe(withoutBlank.checksum);
    });
  });

  describe('candidatesForName', () => {
    it('returns nothing for a name with no tokens', async () => {
      const repo = makeRepo();
      const { service } = makeService(repo);

      expect(await service.candidatesForName('***')).toEqual([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('queries enabled rows by exact normalised name or shared token', async () => {
      const rows = [{ id: 'row-1' }];
      const repo = makeRepo({ qb: rows });
      const { service } = makeService(repo);

      const result = await service.candidatesForName('Ivan Setrov');

      expect(result).toEqual(rows);
      expect(repo.qb.where).toHaveBeenCalledWith('entry.enabled = :enabled', {
        enabled: true,
      });
      expect(repo.qb.andWhere).toHaveBeenCalledWith(
        '(entry.normalised_name = :normalised OR entry.aliases::text ~ :pattern)',
        { normalised: 'ivan setrov', pattern: 'ivan|setrov' },
      );
      expect(repo.qb.limit).toHaveBeenCalledWith(200);
    });

    it('builds a token pattern that is safe to compile as a regex', async () => {
      const repo = makeRepo();
      const { service } = makeService(repo);

      await service.candidatesForName('O’Brien (Mike)');

      const pattern = repo.qb.andWhere.mock.calls[0][1].pattern;
      expect(pattern).toBe('o|brien|mike');
      expect(() => new RegExp(pattern)).not.toThrow();
    });
  });

  describe('findByIdNumber', () => {
    it('normalises the value before querying', async () => {
      const repo = makeRepo({ qb: [{ id: 'row-9' }] });
      const { service } = makeService(repo);

      const result = await service.findByIdNumber(' 71-29344 ');

      expect(result).toEqual({ id: 'row-9' });
      expect(repo.qb.andWhere).toHaveBeenCalledWith(
        'entry.id_numbers @> :fragment::jsonb',
        { fragment: JSON.stringify([{ normalised: '7129344' }]) },
      );
    });

    it('does not query for an id that normalises to nothing', async () => {
      const repo = makeRepo();
      const { service } = makeService(repo);

      await expect(service.findByIdNumber('---')).resolves.toBeNull();
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('listPeps', () => {
    it('returns enabled PEP entries ordered for review', async () => {
      const repo = makeRepo();
      const { service } = makeService(repo);

      await service.listPeps(25);

      expect(repo.find).toHaveBeenCalledWith({
        where: { isPep: true, enabled: true },
        order: { listSource: 'ASC', name: 'ASC' },
        take: 25,
      });
    });
  });

  describe('countBySource', () => {
    it('reduces grouped rows into a source map', async () => {
      const repo = makeRepo({
        qb: [
          { list_source: 'OFAC', count: '12' },
          { list_source: 'EU', count: '3' },
        ],
      });
      const { service } = makeService(repo);

      await expect(service.countBySource()).resolves.toEqual({
        OFAC: 12,
        EU: 3,
      });
      expect(repo.qb.where).toHaveBeenCalledWith('entry.enabled = :enabled', {
        enabled: true,
      });
    });
  });

  describe('disableEntry', () => {
    it('retires a row without deleting the screening history', async () => {
      const repo = makeRepo();
      const { service } = makeService(repo);

      await service.disableEntry('row-1');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'row-1' },
        { enabled: false },
      );
    });
  });
});
