import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvestmentEventStore } from './investment-event-store.service';
import { InvestmentEvent } from './entities/investment-event.entity';
import { InvestmentStatus } from './entities/investment.entity';

describe('InvestmentEventStore', () => {
  let store: InvestmentEventStore;
  let eventRepo: any;

  beforeEach(async () => {
    eventRepo = {
      create: jest.fn((dto) => ({ id: 'evt-1', ...dto, occurredAt: new Date() })),
      save: jest.fn((evt) => Promise.resolve(evt)),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentEventStore,
        { provide: getRepositoryToken(InvestmentEvent), useValue: eventRepo },
      ],
    }).compile();

    store = module.get<InvestmentEventStore>(InvestmentEventStore);
  });

  it('should be defined', () => {
    expect(store).toBeDefined();
  });

  describe('append', () => {
    it('should save an immutable event to the log', async () => {
      const result = await store.append(
        'inv-123',
        'InvestmentCreated',
        { amountUsd: 1000 },
        'actor-1',
      );

      expect(eventRepo.create).toHaveBeenCalledWith({
        investmentId: 'inv-123',
        eventType: 'InvestmentCreated',
        payload: { amountUsd: 1000 },
        actorId: 'actor-1',
      });
      expect(eventRepo.save).toHaveBeenCalled();
      expect(result.eventType).toBe('InvestmentCreated');
    });
  });

  describe('getEvents', () => {
    it('should return chronological events for an investment', async () => {
      const mockEvents = [
        { id: 'evt-1', investmentId: 'inv-123', eventType: 'InvestmentCreated', occurredAt: new Date() },
      ];
      eventRepo.find.mockResolvedValue(mockEvents);

      const events = await store.getEvents('inv-123');

      expect(events).toEqual(mockEvents);
      expect(eventRepo.find).toHaveBeenCalledWith({
        where: { investmentId: 'inv-123' },
        order: { occurredAt: 'ASC' },
      });
    });
  });

  describe('rebuildStateFromEvents', () => {
    it('should replay historical events to derive state projection', async () => {
      const now = new Date();
      const mockEvents = [
        { id: 'evt-1', investmentId: 'inv-123', eventType: 'InvestmentCreated', occurredAt: now },
        { id: 'evt-2', investmentId: 'inv-123', eventType: 'InvestmentActivated', occurredAt: now },
        { id: 'evt-3', investmentId: 'inv-123', eventType: 'InvestmentReleaseStarted', occurredAt: now },
        { id: 'evt-4', investmentId: 'inv-123', eventType: 'InvestmentCompleted', occurredAt: now },
      ];
      eventRepo.find.mockResolvedValue(mockEvents);

      const projection = await store.rebuildStateFromEvents('inv-123');

      expect(projection.investmentId).toBe('inv-123');
      expect(projection.status).toBe(InvestmentStatus.COMPLETED);
      expect(projection.eventCount).toBe(4);
    });

    it('should project CANCELLED state when cancelled by user', async () => {
      const mockEvents = [
        { id: 'evt-1', investmentId: 'inv-123', eventType: 'InvestmentCreated', occurredAt: new Date() },
        { id: 'evt-2', investmentId: 'inv-123', eventType: 'InvestmentCancelledByUser', occurredAt: new Date() },
      ];
      eventRepo.find.mockResolvedValue(mockEvents);

      const projection = await store.rebuildStateFromEvents('inv-123');

      expect(projection.status).toBe(InvestmentStatus.CANCELLED);
    });
  });
});
