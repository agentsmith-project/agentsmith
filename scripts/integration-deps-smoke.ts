import { Client as PgClient } from 'pg';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import { Client as MinioClient } from 'minio';

interface SmokeConfig {
  postgresUrl: string;
  mongoUrl: string;
  redisUrl: string;
  minioEndPoint: string;
  minioPort: number;
  minioUseSSL: boolean;
  minioAccessKey: string;
  minioSecretKey: string;
  minioBucket: string;
  keycloakBaseUrl: string;
}

function getConfig(): SmokeConfig {
  return {
    postgresUrl: process.env.POSTGRES_URL ?? 'postgresql://mbos:mbos_dev_password@localhost:15432/mbos',
    mongoUrl: process.env.MONGO_URL ?? 'mongodb://mbos:mbos_dev_password@localhost:17017/admin',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:16379',
    minioEndPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    minioPort: Number(process.env.MINIO_PORT ?? '19000'),
    minioUseSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
    minioAccessKey: process.env.MINIO_ACCESS_KEY ?? 'mbos',
    minioSecretKey: process.env.MINIO_SECRET_KEY ?? 'mbos_dev_password',
    minioBucket: process.env.MINIO_BUCKET ?? 'mbos-dev',
    keycloakBaseUrl: process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080',
  };
}

async function smokePostgres(url: string): Promise<void> {
  const client = new PgClient({ connectionString: url });
  await client.connect();
  const result = await client.query('SELECT 1 AS ok');
  await client.end();
  if (result.rows[0]?.ok !== 1) {
    throw new Error('postgres_smoke_failed');
  }
}

async function smokePgvector(url: string): Promise<void> {
  const client = new PgClient({ connectionString: url });
  await client.connect();
  const result = await client.query<{ extname?: string }>(
    "SELECT extname FROM pg_extension WHERE extname = 'vector' LIMIT 1",
  );
  await client.end();
  if (!result.rows[0]?.extname) {
    throw new Error('pgvector_extension_missing');
  }
}

async function smokeMongo(url: string): Promise<void> {
  const client = new MongoClient(url);
  await client.connect();
  const ping = await client.db('admin').command({ ping: 1 });
  await client.close();
  if (ping.ok !== 1) {
    throw new Error('mongo_smoke_failed');
  }
}

async function smokeRedis(url: string): Promise<void> {
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  const pong = await redis.ping();
  await redis.quit();
  if (pong !== 'PONG') {
    throw new Error('redis_smoke_failed');
  }
}

async function smokeMinio(config: SmokeConfig): Promise<void> {
  const client = new MinioClient({
    endPoint: config.minioEndPoint,
    port: config.minioPort,
    useSSL: config.minioUseSSL,
    accessKey: config.minioAccessKey,
    secretKey: config.minioSecretKey,
  });

  const exists = await client.bucketExists(config.minioBucket);
  if (!exists) {
    throw new Error('minio_bucket_missing');
  }

  const key = `smoke-${Date.now()}.txt`;
  const payload = Buffer.from('ok', 'utf-8');
  await client.putObject(config.minioBucket, key, payload, payload.byteLength, {
    'Content-Type': 'text/plain',
  });
  await client.removeObject(config.minioBucket, key);
}

async function smokeKeycloak(baseUrl: string): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/realms/mbos/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`keycloak_http_${res.status}`);
  }

  const data = (await res.json()) as { issuer?: string };
  if (!data.issuer?.includes('/realms/mbos')) {
    throw new Error('keycloak_realm_missing');
  }
}

async function main(): Promise<void> {
  const config = getConfig();

  await smokePostgres(config.postgresUrl);
  process.stdout.write('[smoke] postgres ok\n');

  await smokePgvector(config.postgresUrl);
  process.stdout.write('[smoke] pgvector extension ok\n');

  await smokeMongo(config.mongoUrl);
  process.stdout.write('[smoke] mongo ok\n');

  await smokeRedis(config.redisUrl);
  process.stdout.write('[smoke] redis ok\n');

  await smokeMinio(config);
  process.stdout.write('[smoke] minio ok\n');

  await smokeKeycloak(config.keycloakBaseUrl);
  process.stdout.write('[smoke] keycloak ok\n');

  process.stdout.write('[smoke] all integration dependencies reachable\n');
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown_error';
  process.stderr.write(`[smoke] failed: ${message}\n`);
  process.exit(1);
});
