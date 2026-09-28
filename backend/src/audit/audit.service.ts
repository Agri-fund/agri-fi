import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemAuditLog } from './entities/system-audit-log.entity';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(SystemAuditLog)
    private readonly auditRepository: Repository<SystemAuditLog>,
  ) {}

  async logEvent(
    entry: Partial<SystemAuditLog>,
  ): Promise<SystemAuditLog | null> {
    try {
      const auditLog = this.auditRepository.create(entry);
      return await this.auditRepository.save(auditLog);
    } catch (err: any) {
      this.logger.error(
        `Failed to persist system audit log: ${err?.message || err}`,
        err?.stack,
      );
      return null;
    }
  }

  async findAll(limit = 100): Promise<SystemAuditLog[]> {
    return this.auditRepository.find({
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }
}
