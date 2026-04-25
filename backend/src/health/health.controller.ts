import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  MicroserviceHealthIndicator,
} from '@nestjs/terminus';
import { Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private microservice: MicroserviceHealthIndicator,
    private config: ConfigService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    const rabbitmqUrl = this.config.get<string>(
      'RABBITMQ_URL',
      'amqp://guest:guest@localhost:5672',
    );

    return this.health.check([
      () => this.db.pingCheck('database'),
      () =>
        this.microservice.pingCheck('rabbitmq', {
          transport: Transport.RMQ,
          options: {
            urls: [rabbitmqUrl],
          },
        }),
    ]);
  }
}
