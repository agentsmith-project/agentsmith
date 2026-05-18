import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type QueryResult } from 'pg';

type BootstrapWriter = {
  write: (message: string) => unknown;
};

type BootstrapEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type ProductSchemaBootstrapOptions = {
  env?: BootstrapEnv;
  sqlDir?: string;
  stdout?: BootstrapWriter;
  stderr?: BootstrapWriter;
};

type ProductSchemaSqlFile = {
  name: string;
  sql: string;
};

type ExistsRow = {
  exists: boolean;
};

type ProjectColumnRow = {
  column_name: string;
  data_type: string;
};

type RequiredProjectColumn = {
  name: string;
  dataType: string;
};

const currentModulePath = fileURLToPath(import.meta.url);
const REQUIRED_PROJECT_COLUMNS: RequiredProjectColumn[] = [
  { name: 'id', dataType: 'text' },
  { name: 'workspace_id', dataType: 'text' },
  { name: 'name', dataType: 'text' },
  { name: 'description', dataType: 'text' },
  { name: 'visibility', dataType: 'text' },
  { name: 'join_policy', dataType: 'text' },
  { name: 'owner_id', dataType: 'text' },
  { name: 'status', dataType: 'text' },
  { name: 'created_at', dataType: 'timestamp with time zone' },
  { name: 'updated_at', dataType: 'timestamp with time zone' },
];

export function getDefaultProductSchemaSqlDir(): string {
  return path.resolve(path.dirname(currentModulePath), '../../adapters-private/sql');
}

export async function runProductSchemaBootstrap(
  options: ProductSchemaBootstrapOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const databaseUrl = readRequiredDatabaseUrl(env);
  const sqlDir = options.sqlDir ?? getDefaultProductSchemaSqlDir();
  const sqlFiles = await readProductSchemaSqlFiles(sqlDir);
  const shouldCheckVectorExtension = sqlFiles.some((file) => createsVectorExtension(file.sql));
  const client = new Client({ connectionString: databaseUrl });
  let connected = false;

  try {
    await client.connect();
    connected = true;

    for (const file of sqlFiles) {
      await client.query(file.sql);
      stdout.write(`[product-schema-bootstrap] applied ${file.name}\n`);
    }

    await assertProjectsTableExists(client);
    await assertProjectsSchemaReady(client);
    stdout.write('[product-schema-bootstrap] verified public.projects\n');

    if (shouldCheckVectorExtension) {
      await assertVectorExtensionExists(client);
      stdout.write('[product-schema-bootstrap] verified vector extension\n');
    }
  } finally {
    if (connected) {
      await client.end();
    }
  }
}

export async function runProductSchemaBootstrapCli(
  options: ProductSchemaBootstrapOptions = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    await runProductSchemaBootstrap({ ...options, env, stdout, stderr });
    stdout.write('[product-schema-bootstrap] completed\n');
    return 0;
  } catch (error) {
    stderr.write(`[product-schema-bootstrap] failed: ${sanitizeBootstrapError(error, env)}\n`);
    return 1;
  }
}

async function readProductSchemaSqlFiles(sqlDir: string): Promise<ProductSchemaSqlFile[]> {
  const entries = await readdir(sqlDir, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (fileNames.length === 0) {
    throw new Error('no_product_schema_sql_files_found');
  }

  return Promise.all(fileNames.map(async (name) => {
    const filePath = path.join(sqlDir, name);
    return {
      name,
      sql: await readFile(filePath, 'utf8'),
    };
  }));
}

function readRequiredDatabaseUrl(env: BootstrapEnv): string {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return databaseUrl;
}

function createsVectorExtension(sql: string): boolean {
  return /\bCREATE\s+EXTENSION\b[\s\S]*\bvector\b/i.test(sql);
}

async function assertProjectsTableExists(client: Client): Promise<void> {
  const result = await client.query<ExistsRow>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'projects'
    ) AS exists
  `);
  if (!readExists(result, 'public.projects')) {
    throw new Error('public_projects_table_missing_after_schema_bootstrap');
  }
}

async function assertProjectsSchemaReady(client: Client): Promise<void> {
  const result = await client.query<ProjectColumnRow>(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = ANY($1::text[])
  `, [REQUIRED_PROJECT_COLUMNS.map((column) => column.name)]);
  const actualColumns = new Map<string, string>();

  for (const row of result.rows) {
    if (typeof row.column_name !== 'string' || typeof row.data_type !== 'string') {
      throw new Error('invalid_schema_bootstrap_check_result:public.projects.columns');
    }
    actualColumns.set(row.column_name, row.data_type.toLowerCase());
  }

  const missingColumns = REQUIRED_PROJECT_COLUMNS
    .filter((column) => !actualColumns.has(column.name))
    .map((column) => column.name)
    .sort((left, right) => left.localeCompare(right));
  if (missingColumns.length > 0) {
    throw new Error(`public_projects_schema_missing_required_columns:${missingColumns.join(',')}`);
  }

  const invalidColumnTypes = REQUIRED_PROJECT_COLUMNS
    .filter((column) => actualColumns.get(column.name) !== column.dataType)
    .map((column) => `${column.name}:${actualColumns.get(column.name)}!=${column.dataType}`)
    .sort((left, right) => left.localeCompare(right));
  if (invalidColumnTypes.length > 0) {
    throw new Error(`public_projects_schema_invalid_required_column_types:${invalidColumnTypes.join(',')}`);
  }
}

async function assertVectorExtensionExists(client: Client): Promise<void> {
  const result = await client.query<ExistsRow>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'vector'
    ) AS exists
  `);
  if (!readExists(result, 'vector extension')) {
    throw new Error('vector_extension_missing_after_schema_bootstrap');
  }
}

function readExists(result: QueryResult<ExistsRow>, checkName: string): boolean {
  const row = result.rows[0];
  if (!row || typeof row.exists !== 'boolean') {
    throw new Error(`invalid_schema_bootstrap_check_result:${checkName}`);
  }
  return row.exists;
}

function sanitizeBootstrapError(error: unknown, env: BootstrapEnv): string {
  let message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'unknown_error';

  for (const secret of collectSensitiveValues(env)) {
    message = replaceAll(message, secret, '<redacted>');
  }

  return message
    .replace(/\b(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+(@[^\s]*)/gi, '$1<redacted>$2')
    .replace(/\b(DATABASE_URL)=\S+/g, '$1=<redacted>')
    .replace(/\b(password|secret|token|access_key|key)=\S+/gi, '$1=<redacted>');
}

function collectSensitiveValues(env: BootstrapEnv): string[] {
  const values = new Set<string>();
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    values.add(databaseUrl);
    for (const password of readUrlPasswordValues(databaseUrl)) {
      values.add(password);
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 2) continue;
    if (isSensitiveEnvKey(key)) {
      values.add(value);
    }
  }

  return [...values].sort((left, right) => right.length - left.length);
}

function isSensitiveEnvKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  return normalizedKey === 'DATABASE_URL'
    || normalizedKey === 'KEY'
    || normalizedKey.endsWith('_KEY')
    || /(PASSWORD|SECRET|TOKEN|ACCESS_KEY)/.test(normalizedKey);
}

function readUrlPasswordValues(url: string): string[] {
  try {
    const password = new URL(url).password;
    if (!password) {
      return [];
    }
    const values = new Set([password]);
    try {
      const decodedPassword = decodeURIComponent(password);
      if (decodedPassword) {
        values.add(decodedPassword);
      }
    } catch {
      // Keep the raw password redaction even if a legacy URL contains malformed escapes.
    }
    return [...values];
  } catch {
    return [];
  }
}

function replaceAll(input: string, search: string, replacement: string): string {
  return input.split(search).join(replacement);
}

if (process.argv[1] && currentModulePath === path.resolve(process.argv[1])) {
  void runProductSchemaBootstrapCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
