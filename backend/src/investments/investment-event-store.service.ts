import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvestmentEvent, InvestmentEventType } from './entities/investment-event.entity';
import { InvestmentStatus } from './entities/investment.entity';

export interface StateProjection {
  investmentId: string;
  status: InvestmentStatus;
  eventCount: number;
  lastEventAt: Date | null;
}

@Injectable()
export class InvestmentEventStore {
  private readonly logger = new Logger(InvestmentEventStore.name);

  constructor(
    @InjectRepository(InvestmentEvent)
    private readonly eventRepo: Repository<InvestmentEvent>,
  ) {}

  /**
   * Appends an immutable event to the event log.
   */
  async append(
    investmentId: string,
    eventType: InvestmentEventType,
    payload: Record<string, any> = {},
    actorId?: string,
  ): Promise<InvestmentEvent> {
    const event = this.eventRepo.create({
      investmentId,
      eventType,
      payload,
      actorId: actorId ?? null,
    });
    const saved = await this.eventRepo.save(event);
    this.logger.log(`Appended event ${eventType} for investment ${investmentId}`);
    return saved;
  }

  /**
   * Retrieves all chronological events for an investment.
   */
  async getEvents(investmentId: string): Promise<InvestmentEvent[]> {
    return this.eventRepo.find({
      where: { investmentId },
      order: { occurredAt: 'ASC' },
    });
  }

  /**
   * Derives current investment state projection by replaying historical events.
   */
  async rebuildStateFromEvents(investmentId: string): Promise<StateProjection> {
    const events = await this.getEvents(investmentId);
    if (events.length === 0) {
      throw new NotFoundException(`No events found for investment ${investmentId}`);
    }

    let status = InvestmentStatus.PENDING;

    for (const event of events) {
      switch (event.eventType) {
        case 'InvestmentCreated':
          status = InvestmentStatus.PENDING;
          break;
        case 'InvestmentActivated':
          status = InvestmentStatus.ACTIVE;
          break;
        case 'InvestmentReleaseStarted':
          status = InvestmentStatus.RELEASING;
          break;
        case 'InvestmentCompleted':
          status = InvestmentStatus.COMPLETED;
          break;
        case 'InvestmentCancelledByUser':
          status = InvestmentStatus.CANCELLED;
          break;
        case 'InvestmentRefunded':
          status = InvestmentStatus.REFUNDED;
          break;
        case 'InvestmentFailedEscrow':
          status = InvestmentStatus.FAILED;
          break;
      }
    }

    return {
      investmentId,
      status,
      eventCount: events.length,
      lastEventAt: events[events.length - 1].occurredAt,
    };
  }
}
