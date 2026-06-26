import { AuditSubscriber } from './audit.subscriber';
import { AuditLog } from '../entities/audit-log.entity';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { InsertEvent, UpdateEvent } from 'typeorm';

describe('AuditSubscriber', () => {
  let subscriber: AuditSubscriber;
  let mockManager: { save: jest.Mock };
  let mockDataSource: { subscribers: AuditSubscriber[] };

  const baseDeal: Partial<TradeDeal> = {
    id: 'deal-uuid',
    commodity: 'Maize',
    status: 'draft',
    totalValue: 5000,
    tokenCount: 50,
    tokenSymbol: 'MZE-001',
  };

  beforeEach(() => {
    mockManager = { save: jest.fn().mockResolvedValue({}) };
    mockDataSource = { subscribers: [] };
    subscriber = new AuditSubscriber(mockDataSource as any);
  });

  it('registers itself with the DataSource subscribers list on construction', () => {
    expect(mockDataSource.subscribers).toContain(subscriber);
  });

  it('listens to the TradeDeal entity', () => {
    expect(subscriber.listenTo()).toBe(TradeDeal);
  });

  describe('afterInsert', () => {
    it('writes an AuditLog INSERT record when a TradeDeal is saved', async () => {
      const event = {
        entity: baseDeal,
        manager: mockManager,
      } as unknown as InsertEvent<TradeDeal>;

      await subscriber.afterInsert(event);

      expect(mockManager.save).toHaveBeenCalledTimes(1);
      expect(mockManager.save).toHaveBeenCalledWith(
        AuditLog,
        expect.objectContaining({
          entityName: 'TradeDeal',
          entityId: 'deal-uuid',
          action: 'INSERT',
        }),
      );
    });

    it('serialises the inserted entity as JSON in the changes field', async () => {
      const event = {
        entity: baseDeal,
        manager: mockManager,
      } as unknown as InsertEvent<TradeDeal>;

      await subscriber.afterInsert(event);

      const [, auditPayload] = mockManager.save.mock.calls[0];
      const parsed = JSON.parse(auditPayload.changes);
      expect(parsed).toMatchObject({ id: 'deal-uuid', commodity: 'Maize' });
    });

    it('stores a null entityId when the inserted entity has no id', async () => {
      const event = {
        entity: {},
        manager: mockManager,
      } as unknown as InsertEvent<TradeDeal>;

      await subscriber.afterInsert(event);

      const [, auditPayload] = mockManager.save.mock.calls[0];
      expect(auditPayload.entityId).toBeNull();
    });
  });

  describe('afterUpdate', () => {
    it('writes an AuditLog UPDATE record when a TradeDeal is modified', async () => {
      const event = {
        entity: { ...baseDeal, status: 'open' },
        manager: mockManager,
        updatedColumns: [{ propertyName: 'status' }],
      } as unknown as UpdateEvent<TradeDeal>;

      await subscriber.afterUpdate(event);

      expect(mockManager.save).toHaveBeenCalledTimes(1);
      expect(mockManager.save).toHaveBeenCalledWith(
        AuditLog,
        expect.objectContaining({
          entityName: 'TradeDeal',
          entityId: 'deal-uuid',
          action: 'UPDATE',
        }),
      );
    });

    it('records the names of all updated columns in the changes field', async () => {
      const event = {
        entity: baseDeal,
        manager: mockManager,
        updatedColumns: [
          { propertyName: 'status' },
          { propertyName: 'totalInvested' },
        ],
      } as unknown as UpdateEvent<TradeDeal>;

      await subscriber.afterUpdate(event);

      const [, auditPayload] = mockManager.save.mock.calls[0];
      expect(JSON.parse(auditPayload.changes)).toEqual([
        'status',
        'totalInvested',
      ]);
    });

    it('stores an empty changes array when no columns are listed', async () => {
      const event = {
        entity: baseDeal,
        manager: mockManager,
        updatedColumns: [],
      } as unknown as UpdateEvent<TradeDeal>;

      await subscriber.afterUpdate(event);

      const [, auditPayload] = mockManager.save.mock.calls[0];
      expect(JSON.parse(auditPayload.changes)).toEqual([]);
    });
  });
});
