/**
 * ActivityFeedService
 *
 * Issue #863 — Deal update timeline: activity feed for investors.
 *
 * Aggregates events from:
 *  - system_audit_logs  (investor_joined, document_uploaded, status changes, payouts)
 *  - shipment_milestones (shipment progress)
 *
 * Privacy: investment amounts are anonymised for non-admin viewers.
 * Cursor-based pagination using ISO timestamp encoded as base64.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { TradeDeal } from './entities/trade-deal.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { SystemAuditLog } from '../audit/entities/system-audit-log.entity';
import {
  ActivityEventDto,
  ActivityEventType,
  ActivityFeedResponseDto,
} from './dto/activity-feed.dto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Audit route patterns that map to activity event types
const ROUTE_TO_EVENT: Array<{ pattern: RegExp; type: ActivityEventType }> = [
  { pattern: /POST \/v1\/investments/i,                  type: 'investor_joined' },
  { pattern: /POST \/v1\/trade-deals\/[^/]+\/documents/i, type: 'document_uploaded' },
  { pattern: /PATCH \/v1\/trade-deals\/[^/]+\/status/i,  type: 'deal_status_changed' },
  { pattern: /POST \/v1\/payments\/distribute/i,         type: 'payment_distributed' },
];

@Injectable()
export class ActivityFeedService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    @InjectRepository(SystemAuditLog)
    private readonly auditRepo: Repository<SystemAuditLog>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ActivityFeedService.name);
  }

  async getFeed(
    dealId: string,
    opts: { cursor?: string; limit?: number; isAdmin: boolean },
  ): Promise<ActivityFeedResponseDto> {
    // Validate deal exists
    const deal = await this.tradeDealRepo.findOne({ where: { id: dealId } });
    if (!deal) throw new NotFoundException('Trade deal not found');

    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const before: Date | undefined = opts.cursor
      ? this.decodeCursor(opts.cursor)
      : undefined;

    // ── Fetch from both sources in parallel ──────────────────────────────────
    const [milestones, auditLogs] = await Promise.all([
      this.fetchMilestoneEvents(dealId, before),
      this.fetchAuditEvents(dealId, before),
    ]);

    // ── Merge and sort descending by timestamp ────────────────────────────────
    const raw: ActivityEventDto[] = [...milestones, ...auditLogs];
    raw.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const page = raw.slice(0, limit);
    const hasMore = raw.length > limit;

    const nextCursor =
      hasMore && page.length > 0
        ? this.encodeCursor(new Date(page[page.length - 1].createdAt))
        : null;

    // Anonymise investment amounts for non-admin viewers
    if (!opts.isAdmin) {
      for (const ev of page) {
        if (ev.type === 'investor_joined') {
          delete ev.meta['amount'];
          delete ev.meta['amountUsd'];
        }
        if (ev.type === 'payment_distributed') {
          delete ev.meta['perInvestorAmounts'];
        }
      }
    }

    return { events: page, nextCursor, total: raw.length };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async fetchMilestoneEvents(
    dealId: string,
    before?: Date,
  ): Promise<ActivityEventDto[]> {
    const whereClause: Record<string, unknown> = { tradeDealId: dealId };
    if (before) whereClause['recordedAt'] = LessThan(before);

    const milestones = await this.milestoneRepo.find({
      where: whereClause as any,
      order: { recordedAt: 'DESC' },
      take: MAX_LIMIT,
    });

    return milestones.map((m) => ({
      id: `milestone-${m.id}`,
      type: 'shipment_milestone' as ActivityEventType,
      description: this.describeMilestone(m.milestone as string),
      createdAt: m.recordedAt.toISOString(),
      meta: {
        milestone: m.milestone,
        notes: m.notes ?? undefined,
        stellarTxId: m.stellarTxId ?? undefined,
      },
    }));
  }

  private async fetchAuditEvents(
    dealId: string,
    before?: Date,
  ): Promise<ActivityEventDto[]> {
    // Fetch recent audit logs that reference this deal (via requestDetails.params.id)
    // We fetch a generous batch and filter in-memory for deal relevance.
    const whereClause: Record<string, unknown> = {};
    if (before) whereClause['timestamp'] = LessThan(before);

    const logs = await this.auditRepo.find({
      where: whereClause as any,
      order: { timestamp: 'DESC' },
      take: 200, // fetch generous batch, filter below
    });

    const events: ActivityEventDto[] = [];
    for (const log of logs) {
      if (!this.logBelongsToDeal(log, dealId)) continue;

      const eventType = this.resolveEventType(log);
      if (!eventType) continue;

      events.push({
        id: `audit-${log.id}`,
        type: eventType,
        description: this.describeAuditEvent(eventType, log),
        createdAt: log.timestamp.toISOString(),
        meta: this.buildAuditMeta(eventType, log),
      });
    }
    return events;
  }

  private logBelongsToDeal(log: SystemAuditLog, dealId: string): boolean {
    if (!log.requestDetails) return false;
    const params = log.requestDetails['params'] as Record<string, string> | undefined;
    if (params?.['id'] === dealId) return true;
    const body = log.requestDetails['body'] as Record<string, unknown> | undefined;
    if (body?.['trade_deal_id'] === dealId || body?.['tradeDealId'] === dealId) return true;
    return false;
  }

  private resolveEventType(log: SystemAuditLog): ActivityEventType | null {
    if (log.statusCode && log.statusCode >= 400) return null; // skip failed requests
    for (const { pattern, type } of ROUTE_TO_EVENT) {
      if (pattern.test(log.route)) return type;
    }
    return null;
  }

  private describeAuditEvent(
    type: ActivityEventType,
    log: SystemAuditLog,
  ): string {
    switch (type) {
      case 'investor_joined':
        return 'A new investor joined the deal';
      case 'document_uploaded':
        return 'A new document was uploaded by the farmer';
      case 'deal_status_changed': {
        const newStatus =
          (log.requestDetails?.['body'] as any)?.['status'] ?? 'unknown';
        return `Deal status changed to ${newStatus}`;
      }
      case 'payment_distributed':
        return 'A payment distribution was triggered';
      default:
        return type.replace(/_/g, ' ');
    }
  }

  private buildAuditMeta(
    type: ActivityEventType,
    log: SystemAuditLog,
  ): Record<string, unknown> {
    const body = (log.requestDetails?.['body'] as Record<string, unknown>) ?? {};
    switch (type) {
      case 'investor_joined':
        return {
          amount: body['amount_usd'] ?? body['amountUsd'],
          amountUsd: body['amount_usd'] ?? body['amountUsd'],
        };
      case 'document_uploaded':
        return {
          docType: body['doc_type'] ?? body['docType'],
          ipfsHash: body['ipfs_hash'] ?? body['ipfsHash'],
        };
      case 'deal_status_changed':
        return { newStatus: body['status'] };
      case 'payment_distributed':
        return { totalAmount: body['total_amount'] ?? body['totalAmount'] };
      default:
        return {};
    }
  }

  private describeMilestone(milestone: string): string {
    const labels: Record<string, string> = {
      farm: 'Shipment milestone reached: Farm collection',
      warehouse: 'Shipment milestone reached: Warehouse storage',
      port: 'Shipment milestone reached: Port shipment',
      importer: 'Shipment milestone reached: Importer receipt',
    };
    return (
      labels[milestone] ??
      `Shipment milestone reached: ${milestone.replace(/_/g, ' ')}`
    );
  }

  private encodeCursor(date: Date): string {
    return Buffer.from(date.toISOString()).toString('base64url');
  }

  private decodeCursor(cursor: string): Date {
    try {
      return new Date(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      return new Date();
    }
  }
}
