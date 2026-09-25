import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { AuditLog } from '../entities/audit-log.entity';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';

const SENSITIVE_FIELDS = new Set(['escrowSecretKey', 'issuerSecretKey']);

function sanitize(
  entity: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!entity) return null;
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => !SENSITIVE_FIELDS.has(key)),
  );
}

/**
 * Writes an immutable audit trail of every insert/update on TradeDeal for
 * regulatory compliance. Records old/new state (sanitised of secrets), the
 * updated column names, and the acting user's identity pulled from CLS
 * (populated per-request by UserContextInterceptor).
 */
@Injectable()
@EventSubscriber()
export class TradeDealAuditSubscriber implements EntitySubscriberInterface<TradeDeal> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cls: ClsService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return TradeDeal;
  }

  private getUserId(): string | null {
    try {
      return this.cls.get('userId') ?? null;
    } catch {
      // CLS context not available (e.g. migrations, seed scripts)
      return null;
    }
  }

  async afterInsert(event: InsertEvent<TradeDeal>): Promise<void> {
    const entity = event.entity as unknown as
      Record<string, unknown> | undefined;
    await event.manager.save(AuditLog, {
      entityName: 'TradeDeal',
      entityId: entity?.['id'] ? String(entity['id']) : null,
      action: 'INSERT',
      oldValues: null,
      newValues: sanitize(entity ?? null),
      changes: JSON.stringify(sanitize(entity ?? null)),
      userId: this.getUserId(),
    } as any);
  }

  async afterUpdate(event: UpdateEvent<TradeDeal>): Promise<void> {
    const entity = event.entity as unknown as
      Record<string, unknown> | undefined;
    const databaseEntity = event.databaseEntity as unknown as
      Record<string, unknown> | undefined;
    const updatedColumns = (event.updatedColumns ?? []).map(
      (col) => col.propertyName,
    );

    await event.manager.save(AuditLog, {
      entityName: 'TradeDeal',
      entityId: entity?.['id'] ? String(entity['id']) : null,
      action: 'UPDATE',
      oldValues: sanitize(databaseEntity ?? null),
      newValues: sanitize(entity ?? null),
      changes: JSON.stringify(updatedColumns),
      userId: this.getUserId(),
    } as any);
  }
}
