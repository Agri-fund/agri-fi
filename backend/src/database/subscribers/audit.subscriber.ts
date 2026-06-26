import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
  RemoveEvent,
} from 'typeorm';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';

const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'refreshToken',
  'refresh_token',
  'accessToken',
  'access_token',
  'secret',
  'privateKey',
  'private_key',
]);

function sanitize(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !SENSITIVE_FIELDS.has(key)),
  );
}

@Injectable()
@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    dataSource.subscribers.push(this);
  }

  private getUserId(event: any): string | null {
    return (event.queryRunner?.data?.userId as string) ?? null;
  }

  async afterInsert(event: InsertEvent<any>): Promise<void> {
    const entity = event.entity as Record<string, unknown> | undefined;
    await event.manager.save(AuditLog, {
      entityName: event.metadata.name,
      entityId: entity?.['id'] ? String(entity['id']) : null,
      action: 'INSERT' as const,
      oldValues: null,
      newValues: sanitize(entity ?? null),
      userId: this.getUserId(event),
    });
  }

  async afterUpdate(event: UpdateEvent<any>): Promise<void> {
    const entity = event.entity as Record<string, unknown> | undefined;
    const databaseEntity = event.databaseEntity as Record<string, unknown> | undefined;
    await event.manager.save(AuditLog, {
      entityName: event.metadata.name,
      entityId: entity?.['id'] ? String(entity['id']) : null,
      action: 'UPDATE' as const,
      oldValues: sanitize(databaseEntity ?? null),
      newValues: sanitize(entity ?? null),
      userId: this.getUserId(event),
    });
  }

  async afterRemove(event: RemoveEvent<any>): Promise<void> {
    const entity = event.entity as Record<string, unknown> | undefined;
    const databaseEntity = event.databaseEntity as Record<string, unknown> | undefined;
    await event.manager.save(AuditLog, {
      entityName: event.metadata.name,
      entityId: entity?.['id'] ? String(entity['id']) : null,
      action: 'DELETE' as const,
      oldValues: sanitize(databaseEntity ?? entity ?? null),
      newValues: null,
      userId: this.getUserId(event),
    });
  }
}
