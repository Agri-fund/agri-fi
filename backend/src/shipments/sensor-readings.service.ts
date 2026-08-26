import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { ShipmentSensorReading, SensorType } from './entities/shipment-sensor-reading.entity';
import { CreateSensorReadingsDto } from './dto/create-sensor-readings.dto';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

/** Acceptable ranges per sensor type — configurable via env overrides. */
const RANGE_DEFAULTS: Record<SensorType, { min: number; max: number }> = {
  TEMPERATURE: {
    min: parseFloat(process.env.SENSOR_TEMP_MIN ?? '-5'),
    max: parseFloat(process.env.SENSOR_TEMP_MAX ?? '30'),
  },
  HUMIDITY: {
    min: parseFloat(process.env.SENSOR_HUMIDITY_MIN ?? '20'),
    max: parseFloat(process.env.SENSOR_HUMIDITY_MAX ?? '85'),
  },
  CO2: {
    min: parseFloat(process.env.SENSOR_CO2_MIN ?? '0'),
    max: parseFloat(process.env.SENSOR_CO2_MAX ?? '5000'),
  },
  VIBRATION: {
    min: parseFloat(process.env.SENSOR_VIBRATION_MIN ?? '0'),
    max: parseFloat(process.env.SENSOR_VIBRATION_MAX ?? '10'),
  },
};

function isOutOfRange(sensorType: SensorType, value: number): boolean {
  const range = RANGE_DEFAULTS[sensorType];
  return value < range.min || value > range.max;
}

@Injectable()
export class SensorReadingsService {
  constructor(
    private readonly logger: PinoLogger,
    @InjectRepository(ShipmentSensorReading)
    private readonly readingRepo: Repository<ShipmentSensorReading>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
  ) {
    this.logger.setContext(SensorReadingsService.name);
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
      const outOfRange = isOutOfRange(r.sensorType as SensorType, r.value);
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
