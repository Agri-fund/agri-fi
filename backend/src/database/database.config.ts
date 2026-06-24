import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { join } from 'path';

@Injectable()
export class DatabaseConfig implements TypeOrmOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    return {
      type: 'postgres',
      host: this.config.get<string>('DATABASE_HOST', 'localhost'),
      port: this.config.get<number>('DATABASE_PORT', 5432),
      username: this.config.get<string>('DATABASE_USER', 'postgres'),
      password: this.config.get<string>('DATABASE_PASSWORD', 'postgres'),
      database: this.config.get<string>('DATABASE_NAME', 'agric_onchain'),
      entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
      migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
      synchronize: false,
      // pgAudit requires queries to be logged to CloudWatch in production
      logging: this.config.get<string>('NODE_ENV') === 'development' ? 'all' : ['query', 'error'],
    };
  }
}
