import { DataSource } from 'typeorm';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

/** Parse a postgres:// URL into explicit TypeORM connection fields.
 *  TypeORM replication mode does not honour the `url` shorthand, so we
 *  must expand it ourselves. */
function parseDbUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || '5432', 10),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

const databaseUrl = process.env.DATABASE_URL;
const databaseReplicaUrl = process.env.DATABASE_REPLICA_URL;

const masterConnection = databaseUrl
  ? parseDbUrl(databaseUrl)
  : {
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
      username: process.env.DATABASE_USER ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? 'postgres',
      database: process.env.DATABASE_NAME ?? 'agric_onchain',
    };

const slaveConnection = databaseReplicaUrl
  ? parseDbUrl(databaseReplicaUrl)
  : {
      host:
        process.env.DATABASE_REPLICA_HOST ??
        process.env.DATABASE_HOST ??
        'localhost',
      port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
      username: process.env.DATABASE_USER ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? 'postgres',
      database: process.env.DATABASE_NAME ?? 'agric_onchain',
    };

const dataSourceConfig: any = {
  type: 'postgres',
  replication: {
    master: masterConnection,
    slaves: [slaveConnection],
  },
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: false,
};

export const AppDataSource = new DataSource(dataSourceConfig);
