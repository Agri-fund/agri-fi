import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export type SensorType = 'TEMPERATURE' | 'HUMIDITY' | 'CO2' | 'VIBRATION';

@Entity('shipment_sensor_readings')
@Index(['shipmentId', 'recordedAt'])
export class ShipmentSensorReading {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ name: 'shipment_id' })
  @ApiProperty({ description: 'Trade deal / shipment UUID' })
  shipmentId: string;

  @Column({ name: 'milestone_id', nullable: true })
  @ApiProperty({ required: false })
  milestoneId: string | null;

  @Column({ name: 'sensor_type', type: 'varchar' })
  @ApiProperty({ enum: ['TEMPERATURE', 'HUMIDITY', 'CO2', 'VIBRATION'] })
  sensorType: SensorType;

  @Column({ type: 'double precision' })
  @ApiProperty()
  value: number;

  @Column({ type: 'varchar', length: 20 })
  @ApiProperty({ example: '°C' })
  unit: string;

  @Column({ name: 'device_id', type: 'varchar', length: 128 })
  @ApiProperty()
  deviceId: string;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  @ApiProperty()
  recordedAt: Date;

  @Column({ name: 'out_of_range', default: false })
  @ApiProperty()
  outOfRange: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
