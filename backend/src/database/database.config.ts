import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { join } from 'path';

@Injectable()
export class DatabaseConfig implements TypeOrmOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const masterConnection = {
      host: this.config.get<string>('DATABASE_HOST', 'localhost'),
      port: this.config.get<number>('DATABASE_PORT', 5432),
      username: this.config.get<string>('DATABASE_USER', 'postgres'),
      password: this.config.get<string>('DATABASE_PASSWORD', 'postgres'),
      database: this.config.get<string>('DATABASE_NAME', 'agric_onchain'),
    };

    // Falls back to the primary when no replica is configured, so read
    // queries stay correct in environments without one (local/dev).
    const replicaConnection = {
      ...masterConnection,
      host: this.config.get<string>(
        'DATABASE_REPLICA_HOST',
        masterConnection.host,
      ),
    };

    return {
      type: 'postgres',
      replication: {
        master: masterConnection,
        slaves: [replicaConnection],
      },
      entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
      migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
      synchronize: false,
      // pgAudit requires queries to be logged to CloudWatch in production
      logging:
        this.config.get<string>('NODE_ENV') === 'development'
          ? 'all'
          : ['query', 'error'],
      retryAttempts: 10,
      retryDelay: 3000,
      extra: {
        // Max simultaneous connections in the pool. Default (10) was
        // exhausted under high concurrent load; production traffic needs headroom.
        max: this.config.get<number>(
          'DATABASE_POOL_MAX',
          this.config.get<string>('NODE_ENV') === 'production' ? 50 : 10,
        ),
        idleTimeoutMillis: this.config.get<number>(
          'DATABASE_POOL_IDLE_TIMEOUT_MS',
          30000,
        ),
        connectionTimeoutMillis: this.config.get<number>(
          'DATABASE_POOL_CONNECTION_TIMEOUT_MS',
          5000,
        ),
      },
    };
  }
}
