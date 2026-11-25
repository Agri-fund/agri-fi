import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { In, Repository } from 'typeorm';
import { SavedSearch } from './entities/saved-search.entity';
import { SearchHistory } from './entities/search-history.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSavedSearchDto, RecordSearchDto } from './dto/saved-search.dto';
import {
  DealFilters,
  assertValidDealFilters,
  dealMatchesFilters,
  pickDealFilters,
} from './deal-filters';

export const MAX_SAVED_SEARCHES = 20;
export const MAX_HISTORY = 20;
const MAX_SEEN_IDS = 1000;
const SCAN_DEAL_LIMIT = 500;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DealDiscoveryService {
  private readonly logger = new Logger(DealDiscoveryService.name);

  constructor(
    @InjectRepository(SavedSearch)
    private readonly savedRepo: Repository<SavedSearch>,
    @InjectRepository(SearchHistory)
    private readonly historyRepo: Repository<SearchHistory>,
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Saved searches ────────────────────────────────────────────────────────

  listSaved(userId: string): Promise<SavedSearch[]> {
    return this.savedRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async createSaved(
    userId: string,
    dto: CreateSavedSearchDto,
  ): Promise<SavedSearch> {
    const filters = pickDealFilters(dto.filters as Record<string, unknown>);
    assertValidDealFilters(filters);

    if (
      (await this.savedRepo.count({ where: { userId } })) >= MAX_SAVED_SEARCHES
    ) {
      throw new BadRequestException(
        `You can save at most ${MAX_SAVED_SEARCHES} searches`,
      );
    }

    // Deals that already match are not "new": mark them seen up front.
    const openDeals = await this.openDeals();
    const seenDealIds = openDeals
      .filter((d) => dealMatchesFilters(d, filters))
      .map((d) => d.id);

    return this.savedRepo.save(
      this.savedRepo.create({
        userId,
        name: dto.name.trim(),
        filters,
        notifyInApp: dto.notifyInApp ?? true,
        notifyEmail: dto.notifyEmail ?? false,
        seenDealIds,
      }),
    );
  }

  async deleteSaved(userId: string, id: string): Promise<void> {
    const res = await this.savedRepo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Saved search not found');
  }

  // ── Search history ────────────────────────────────────────────────────────

  listHistory(userId: string): Promise<SearchHistory[]> {
    return this.historyRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: MAX_HISTORY,
    });
  }

  /** Records a search; an identical repeat of the latest entry is not duplicated. */
  async recordHistory(
    userId: string,
    dto: RecordSearchDto,
  ): Promise<SearchHistory | null> {
    const filters = pickDealFilters(dto.filters as Record<string, unknown>);
    assertValidDealFilters(filters);
    if (Object.keys(filters).length === 0) return null;

    const [latest] = await this.historyRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    if (latest && JSON.stringify(latest.filters) === JSON.stringify(filters)) {
      latest.resultCount = dto.resultCount ?? latest.resultCount;
      return this.historyRepo.save(latest);
    }

    const saved = await this.historyRepo.save(
      this.historyRepo.create({
        userId,
        filters,
        resultCount: dto.resultCount ?? 0,
      }),
    );
    const stale = await this.historyRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: MAX_HISTORY,
      select: ['id'],
    });
    if (stale.length) await this.historyRepo.delete(stale.map((h) => h.id));
    return saved;
  }

  async clearHistory(userId: string): Promise<void> {
    await this.historyRepo.delete({ userId });
  }

  // ── Comparison ────────────────────────────────────────────────────────────

  /** Side-by-side data for 2-3 public deals, in the order requested. */
  async compare(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length < 2 || unique.length > 3) {
      throw new BadRequestException('Provide 2 or 3 distinct deal ids');
    }
    if (unique.some((id) => !UUID_RE.test(id))) {
      throw new BadRequestException('Deal ids must be UUIDs');
    }
    const deals = await this.dealRepo.find({
      where: { id: In(unique), status: In(['open', 'funded']) },
    });
    if (deals.length !== unique.length) {
      throw new NotFoundException('One or more deals were not found');
    }
    return unique.map((id) => {
      const d = deals.find((x) => x.id === id)!;
      const value = Number(d.totalValue);
      return {
        id: d.id,
        title: d.title ?? d.commodity,
        commodity: d.commodity,
        country: d.country,
        region: d.region,
        totalValue: value,
        totalInvested: Number(d.totalInvested),
        fundedPct:
          value > 0 ? +((Number(d.totalInvested) / value) * 100).toFixed(2) : 0,
        minInvestment:
          d.minInvestmentLot === null ? null : Number(d.minInvestmentLot),
        expectedRoi: d.expectedRoi === null ? null : Number(d.expectedRoi),
        durationDays: d.durationDays,
        riskRating: d.riskRating,
        esgScore: d.esgScore,
        deliveryDate: d.deliveryDate,
      };
    });
  }

  // ── Saved search alerts ───────────────────────────────────────────────────

  /** Notifies owners of searches about open deals they have not yet been told about. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async notifyMatches(): Promise<number> {
    const searches = await this.savedRepo
      .createQueryBuilder('s')
      .where('s.notify_in_app = true OR s.notify_email = true')
      .getMany();
    if (searches.length === 0) return 0;

    const deals = await this.openDeals();
    let sent = 0;
    for (const search of searches) {
      const seen = new Set(search.seenDealIds);
      const fresh = deals.filter(
        (d) => !seen.has(d.id) && dealMatchesFilters(d, search.filters),
      );
      if (fresh.length === 0) continue;

      try {
        await this.sendAlert(search, fresh);
        sent++;
      } catch (err) {
        this.logger.warn(
          `Saved search ${search.id} alert failed: ${(err as Error).message}`,
        );
        continue; // not marked seen, so the next run retries
      }
      search.seenDealIds = [
        ...search.seenDealIds,
        ...fresh.map((d) => d.id),
      ].slice(-MAX_SEEN_IDS);
      await this.savedRepo.save(search);
    }
    return sent;
  }

  private async sendAlert(search: SavedSearch, deals: TradeDeal[]) {
    const first = deals[0].title ?? deals[0].commodity;
    const title = `New deals match "${search.name}"`;
    const message =
      deals.length === 1
        ? `${first} is now open for investment.`
        : `${first} and ${deals.length - 1} more deals are now open.`;

    if (search.notifyInApp) {
      await this.notifications.createNotification({
        userId: search.userId,
        type: 'deal',
        title,
        message,
        linkUrl: `/marketplace?${new URLSearchParams(
          Object.entries(search.filters).map(([k, v]) => [k, String(v)]),
        ).toString()}`,
        metadataJson: {
          savedSearchId: search.id,
          dealIds: deals.map((d) => d.id),
        },
      });
    }
    if (search.notifyEmail) {
      const user = await this.userRepo.findOne({
        where: { id: search.userId },
      });
      if (user?.email)
        await this.notifications.sendEmail(user.email, title, message);
    }
  }

  private openDeals(): Promise<TradeDeal[]> {
    return this.dealRepo.find({
      where: { status: 'open' },
      order: { createdAt: 'DESC' },
      take: SCAN_DEAL_LIMIT,
    });
  }
}
