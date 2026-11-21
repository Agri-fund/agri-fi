import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import {
  ShipmentSensorReading,
  SensorType,
} from './entities/shipment-sensor-reading.entity';
import { CreateSensorReadingsDto } from './dto/create-sensor-readings.dto';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

interface SensorRange {
  min: number;
  max: number;
}

const RANGE_DEFAULTS: Record<SensorType, SensorRange> = {
  TEMPERATURE: { min: -5, max: 45 },
  HUMIDITY: { min: 20, max: 85 },
  CO2: { min: 350, max: 2500 },
  VIBRATION: { min: 0, max: 10 },
};

const RANGE_KEYS: Record<SensorType, { min: string; max: string }> = {
  TEMPERATURE: { min: 'SENSOR_TEMP_MIN', max: 'SENSOR_TEMP_MAX' },
  HUMIDITY: { min: 'SENSOR_HUMIDITY_MIN', max: 'SENSOR_HUMIDITY_MAX' },
  CO2: { min: 'SENSOR_CO2_MIN', max: 'SENSOR_CO2_MAX' },
  VIBRATION: { min: 'SENSOR_VIBRATION_MIN', max: 'SENSOR_VIBRATION_MAX' },
};

@Injectable()
export class SensorReadingsService {
  private readonly ranges: Record<SensorType, SensorRange>;

  constructor(
    private readonly logger: PinoLogger,
    @InjectRepository(ShipmentSensorReading)
    private readonly readingRepo: Repository<ShipmentSensorReading>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly config: ConfigService,
  ) {
    (this.logger as any).setContext(SensorReadingsService.name);
    this.ranges = {
      TEMPERATURE: this.buildRange('TEMPERATURE'),
      HUMIDITY: this.buildRange('HUMIDITY'),
      CO2: this.buildRange('CO2'),
      VIBRATION: this.buildRange('VIBRATION'),
    };
  }

  private readThreshold(key: string, fallback: number): number {
    const raw = this.config?.get<number | string>(key);
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }

    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      this.logger.error(
        { key, value: raw },
        'Invalid numeric sensor threshold — using documented default',
      );
      return fallback;
    }

    return value;
  }

  private buildRange(sensorType: SensorType): SensorRange {
    const defaults = RANGE_DEFAULTS[sensorType];
    const keys = RANGE_KEYS[sensorType];
    const min = this.readThreshold(keys.min, defaults.min);
    const max = this.readThreshold(keys.max, defaults.max);

    if (min > max) {
      this.logger.error(
        { sensorType, min, max },
        'Sensor threshold min exceeds max — using documented defaults',
      );
      return defaults;
    }

    return { min, max };
  }

  private isOutOfRange(sensorType: SensorType, value: number): boolean {
    const range = this.ranges[sensorType];
    if (!range) {
      return false;
    }
    return value < range.min || value > range.max;
  }

  async ingestBatch(
    shipmentId: string,
    dto: CreateSensorReadingsDto,
  ): Promise<{ saved: number; alerts: number }> {
    if (dto.readings.length === 0) {
      throw new BadRequestException('At least one reading is required.');
    }

    const deal = await this.tradeDealRepo.findOne({
      where: { id: shipmentId },
      select: ['id'],
    });
    if (!deal) {
      throw new NotFoundException('Shipment (trade deal) not found.');
    }

    const entities = dto.readings.map((r) => {
      const outOfRange = this.isOutOfRange(r.sensorType as SensorType, r.value);
      return this.readingRepo.create({
        shipmentId,
        milestoneId: r.milestoneId ?? null,
        sensorType: r.sensorType as SensorType,
        value: r.value,
        unit: r.unit,
        deviceId: r.deviceId,
        recordedAt: new Date(r.recordedAt),
        outOfRange,
      });
    });

    await this.readingRepo.save(entities);

    const alertCount = entities.filter((e) => e.outOfRange).length;
    if (alertCount > 0) {
      this.logger.warn(
        { shipmentId, alertCount },
        'Out-of-range sensor readings detected — alert notification required',
      );
    }

    return { saved: entities.length, alerts: alertCount };
  }

  async findByShipment(shipmentId: string): Promise<ShipmentSensorReading[]> {
    return this.readingRepo.find({
      where: { shipmentId },
      order: { recordedAt: 'ASC' },
    });
  }
}
