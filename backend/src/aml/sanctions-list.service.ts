import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { SanctionsListEntry } from './entities/sanctions-list-entry.entity';
import {
  ImportSanctionsListDto,
  UpsertSanctionsEntryDto,
} from './dto/aml-monitoring.dto';
import { SanctionsEntryType, SanctionsListSource } from './aml.constants';
import { normaliseSanctionsName, normaliseTokenSet } from './aml-name-match';

export interface SanctionsImportResult {
  listSource: string;
  listVersion: string | null;
  created: number;
  updated: number;
  skipped: number;
  checksum: string;
}

/**
 * Owns the sanctions reference data (#1217) for OFAC, UN and EU lists, plus the
 * PEP population. Lists are loaded through `importList()` from whatever parser
 * produced the publisher's dump (SDN.xml, the EU consolidation file, the UN
 * consolidated sheet), keyed by `listSource` + `externalId` so a re-import is
 * an update rather than a duplicate.
 *
 * Deliberately no network fetching: loading a third-party list into the
 * screening path is an explicit operator action through `importList()`, so an
 * upstream list publisher can never silently change who gets blocked.
 */
@Injectable()
export class SanctionsListService {
  private readonly logger = new Logger(SanctionsListService.name);

  constructor(
    @InjectRepository(SanctionsListEntry)
    private readonly entryRepository: Repository<SanctionsListEntry>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Stable key an imported row is matched on: publisher + external id or name.
   * `importList` passes the list it is ingesting because publisher rows do not
   * carry a source of their own, and a checksum that ignored the source could
   * not tell two different lists apart.
   */
  private identity(
    entry: UpsertSanctionsEntryDto,
    listSource?: string,
  ): string {
    const source = listSource ?? entry.listSource;
    if (entry.externalId) return `${source}:${entry.externalId}`;
    return `${source}:name:${normaliseSanctionsName(entry.name)}`;
  }

  async upsert(entry: UpsertSanctionsEntryDto): Promise<SanctionsListEntry> {
    if (!entry?.name?.trim()) {
      throw new BadRequestException('Sanctions entry requires a name');
    }
    const normalised = normaliseSanctionsName(entry.name);
    const existing = entry.externalId
      ? await this.entryRepository.findOne({
          where: {
            listSource: entry.listSource as SanctionsListSource,
            externalId: entry.externalId,
          },
        })
      : await this.entryRepository.findOne({
          where: {
            listSource: entry.listSource as SanctionsListSource,
            normalisedName: normalised,
          },
        });

    const payload = this.payloadFor(entry, entry.listSource);

    if (existing) {
      Object.assign(existing, payload);
      return this.entryRepository.save(existing);
    }
    return this.entryRepository.save(this.entryRepository.create(payload));
  }

  /**
   * Column-safe projection of an incoming entry: enums are narrowed, the id
   * numbers gain their normalised form, and blank optional fields become the
   * stored defaults instead of undefined.
   */
  private payloadFor(
    entry: UpsertSanctionsEntryDto,
    listSource: string,
  ): Partial<SanctionsListEntry> {
    const idNumbers = (entry.idNumbers ?? []).map((idNumber) => ({
      type: String(idNumber.type ?? '').toUpperCase(),
      value: idNumber.value,
      normalised: String(idNumber.value ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, ''),
    }));

    return {
      listSource: listSource as SanctionsListSource,
      externalId: entry.externalId ?? null,
      entryType: (entry.entryType ?? 'PERSON') as SanctionsEntryType,
      name: entry.name.trim(),
      normalisedName: normaliseSanctionsName(entry.name),
      aliases: (entry.aliases ?? []).map((alias) =>
        normaliseSanctionsName(alias),
      ),
      country: entry.country ? entry.country.toUpperCase() : null,
      idNumbers,
      dateOfBirth: entry.dateOfBirth ?? null,
      isPep: entry.isPep ?? false,
      pepRole: entry.pepRole ?? null,
      programme: entry.programme ?? '',
      listVersion: entry.listVersion ?? null,
    };
  }

  /**
   * Bulk import of a parsed publisher list. Runs in one transaction so a
   * half-loaded list can never be used for screening.
   */
  async importList(
    dto: ImportSanctionsListDto,
  ): Promise<SanctionsImportResult> {
    if (!dto?.entries?.length) {
      throw new BadRequestException(
        'Sanctions list import requires at least one entry',
      );
    }
    const hash = createHash('sha256');
    let created = 0;
    let updated = 0;
    let skipped = 0;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SanctionsListEntry);
      for (const entry of dto.entries) {
        if (!entry.name?.trim()) {
          skipped += 1;
          continue;
        }
        hash.update(this.identity(entry, dto.listSource));
        const normalised = normaliseSanctionsName(entry.name);
        const where = entry.externalId
          ? {
              listSource: dto.listSource as SanctionsListSource,
              externalId: entry.externalId,
            }
          : {
              listSource: dto.listSource as SanctionsListSource,
              normalisedName: normalised,
            };
        const existing = await repo.findOne({ where });
        const payload = {
          ...this.payloadFor(entry, dto.listSource),
          listVersion: entry.listVersion ?? dto.listVersion ?? null,
        };
        if (existing) {
          Object.assign(existing, payload);
          await repo.save(existing);
          updated += 1;
        } else {
          await repo.save(repo.create(payload));
          created += 1;
        }
      }
    });

    const result = {
      listSource: dto.listSource,
      listVersion: dto.listVersion ?? null,
      created,
      updated,
      skipped,
      checksum: hash.digest('hex'),
    };
    this.logger.log(
      `Sanctions import ${dto.listSource}: ${created} created, ${updated} updated, ${skipped} skipped`,
    );
    return result;
  }

  /**
   * Candidate rows for a name screen. Exact normalised-name hits plus every
   * entry that shares a surname or given-name token, which is where the fuzzy
   * scoring does the real work.
   */
  async candidatesForName(name: string): Promise<SanctionsListEntry[]> {
    const tokens = normaliseTokenSet(name);
    if (tokens.length === 0) return [];
    const qb = this.entryRepository
      .createQueryBuilder('entry')
      .where('entry.enabled = :enabled', { enabled: true })
      .andWhere(
        '(entry.normalised_name = :normalised OR entry.aliases::text ~ :pattern)',
        {
          normalised: normaliseSanctionsName(name),
          pattern: tokens
            .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|'),
        },
      )
      .limit(200);
    return qb.getMany();
  }

  async findByIdNumber(value: string): Promise<SanctionsListEntry | null> {
    const normalised = String(value ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!normalised) return null;
    return this.entryRepository
      .createQueryBuilder('entry')
      .where('entry.enabled = :enabled', { enabled: true })
      .andWhere(`entry.id_numbers @> :fragment::jsonb`, {
        fragment: JSON.stringify([{ normalised }]),
      })
      .getOne();
  }

  async listPeps(limit = 100): Promise<SanctionsListEntry[]> {
    return this.entryRepository.find({
      where: { isPep: true, enabled: true },
      order: { listSource: 'ASC', name: 'ASC' },
      take: limit,
    });
  }

  async countBySource(): Promise<Record<string, number>> {
    const rows = await this.entryRepository
      .createQueryBuilder('entry')
      .select('entry.list_source', 'list_source')
      .addSelect('COUNT(1)', 'count')
      .where('entry.enabled = :enabled', { enabled: true })
      .groupBy('entry.list_source')
      .getRawMany<{ list_source: string; count: string }>();
    return rows.reduce(
      (acc, row) => ({ ...acc, [row.list_source]: Number(row.count) }),
      {} as Record<string, number>,
    );
  }

  async disableEntry(id: string): Promise<void> {
    await this.entryRepository.update({ id }, { enabled: false });
  }
}
