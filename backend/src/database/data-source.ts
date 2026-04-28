import { DataSource } from 'typeorm';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

const dataSourceConfig: any = {
  type: 'postgres',
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: false,
};

if (databaseUrl) {
  dataSourceConfig.url = databaseUrl;
} else {
  dataSourceConfig.host = process.env.DATABASE_HOST ?? 'localhost';
  dataSourceConfig.port = parseInt(process.env.DATABASE_PORT ?? '5432', 10);
  dataSourceConfig.username = process.env.DATABASE_USER ?? 'postgres';
  dataSourceConfig.password = process.env.DATABASE_PASSWORD ?? 'postgres';
  dataSourceConfig.database = process.env.DATABASE_NAME ?? 'agric_onchain';
}

export const AppDataSource = new DataSource(dataSourceConfig);
