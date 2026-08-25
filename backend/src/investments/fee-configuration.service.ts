import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FeeConfiguration,
  FeeType,
  InvestorTier,
} from '../database/entities/fee-configuration.entity';
import {
  CreateFeeConfigurationDto,
  UpdateFeeConfigurationDto,
  ListFeeConfigurationQueryDto,
} from './dto/fee-configuration.dto';
import {
  PaginatedResult,
  PaginationQuery,
  toPaginatedResult,
} from '../common/pagination';

@Injectable()
export class FeeConfigurationService {
  constructor(
    @InjectRepository(FeeConfiguration)
    private readonly feeConfigRepo: Repository<FeeConfiguration>,
  ) {}

  async create(dto: CreateFeeConfigurationDto): Promise<FeeConfiguration> {
    // Check for duplicate effective date
    const existing = await this.feeConfigRepo.findOne({
      where: {
        dealType: dto.dealType,
        investorTier: dto.investorTier,
        feeType: dto.feeType,
        effectiveFrom: dto.effectiveFrom,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Fee configuration already exists for ${dto.dealType}/${dto.investorTier}/${dto.feeType} effective ${dto.effectiveFrom}`,
      );
    }

    // Validate rate is between 0-100
    if (dto.ratePercent < 0 || dto.ratePercent > 100) {
      throw new BadRequestException('Rate percent must be between 0 and 100');
    }

    // If effectiveTo is provided, ensure it's after effectiveFrom
    if (dto.effectiveTo && dto.effectiveTo <= dto.effectiveFrom) {
      throw new BadRequestException(
        'effectiveTo must be after effectiveFrom',
      );
    }

    const config = this.feeConfigRepo.create(dto);
    return this.feeConfigRepo.save(config);
  }

  async findById(id: string): Promise<FeeConfiguration> {
    const config = await this.feeConfigRepo.findOne({ where: { id } });
    if (!config) {
      throw new NotFoundException(`Fee configuration ${id} not found`);
    }
    return config;
  }

  async list(
    query: ListFeeConfigurationQueryDto,
    pagination: PaginationQuery,
  ): Promise<PaginatedResult<FeeConfiguration>> {
    const qb = this.feeConfigRepo.createQueryBuilder('fc');

    // Apply filters
    if (query.dealType) {
      qb.andWhere('fc.dealType = :dealType', { dealType: query.dealType });
    }

    if (query.investorTier) {
      qb.andWhere('fc.investorTier = :investorTier', {
        investorTier: query.investorTier,
      });
    }

    if (query.feeType) {
      qb.andWhere('fc.feeType = :feeType', { feeType: query.feeType });
    }

    if (query.active !== undefined) {
      const now = new Date();
      if (query.active) {
        // Active: effectiveFrom <= now AND (effectiveTo IS NULL OR effectiveTo > now)
        qb.andWhere('fc.effectiveFrom <= :now', { now })
          .andWhere(
            '(fc.effectiveTo IS NULL OR fc.effectiveTo > :now)',
            { now },
          );
      } else {
        // Inactive: effectiveTo IS NOT NULL AND effectiveTo <= now
        qb.andWhere('fc.effectiveTo IS NOT NULL AND fc.effectiveTo <= :now', {
          now,
        });
      }
    }

    // Sort by effective date descending
    qb.orderBy('fc.effectiveFrom', 'DESC');
    qb.addOrderBy('fc.createdAt', 'DESC');

    return toPaginatedResult(qb, pagination.skip, pagination.take);
  }

  async update(
    id: string,
    dto: UpdateFeeConfigurationDto,
  ): Promise<FeeConfiguration> {
    const config = await this.findById(id);

    // Validate rate if provided
    if (
      dto.ratePercent !== undefined &&
      (dto.ratePercent < 0 || dto.ratePercent > 100)
    ) {
      throw new BadRequestException('Rate percent must be between 0 and 100');
    }

    // If effectiveTo is being updated, validate
    if (
      dto.effectiveTo &&
      config.effectiveFrom &&
      dto.effectiveTo <= config.effectiveFrom
    ) {
      throw new BadRequestException(
        'effectiveTo must be after effectiveFrom',
      );
    }

    Object.assign(config, dto);
    return this.feeConfigRepo.save(config);
  }

  async delete(id: string): Promise<void> {
    const config = await this.findById(id);

    // Prevent deletion of active configurations
    const now = new Date();
    const isActive =
      config.effectiveFrom <= now &&
      (config.effectiveTo === null || config.effectiveTo > now);

    if (isActive) {
      throw new BadRequestException(
        'Cannot delete active fee configuration. Set effectiveTo to expire it instead.',
      );
    }

    await this.feeConfigRepo.remove(config);
  }

  async getAllDealTypes(): Promise<string[]> {
    const results = await this.feeConfigRepo
      .createQueryBuilder('fc')
      .select('DISTINCT fc.dealType', 'dealType')
      .orderBy('fc.dealType', 'ASC')
      .getRawMany();

    return results.map((r) => r.dealType);
  }

  async getConfigurationMatrix(
    dealType: string,
    referenceDate?: Date,
  ): Promise<Record<string, Record<FeeType, number>>> {
    const date = referenceDate || new Date();

    const configs = await this.feeConfigRepo.find({
      where: {
        dealType,
        effectiveFrom: { _type: 'lte', value: date },
        effectiveTo: { _type: 'gt', value: date },
      },
      order: {
        feeType: 'ASC',
        investorTier: 'ASC',
      },
    });

    const matrix: Record<string, Record<FeeType, number>> = {};

    for (const tier of Object.values(InvestorTier)) {
      matrix[tier] = {
        [FeeType.PLATFORM_ORIGINATION]: 0,
        [FeeType.PLATFORM_SUCCESS]: 0,
        [FeeType.INVESTOR_ENTRY]: 0,
        [FeeType.EARLY_EXIT]: 0,
      };

      const tierConfigs = configs.filter((c) => c.investorTier === tier);
      for (const config of tierConfigs) {
        matrix[tier][config.feeType] = config.ratePercent;
      }
    }

    return matrix;
  }
}
