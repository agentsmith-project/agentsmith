import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FsPromisesModule = typeof import('node:fs/promises');
const nodeRequire = createRequire(import.meta.url);

const bootstrapMocks = vi.hoisted(() => {
  const requiredProjectColumnRows = [
    { column_name: 'id', data_type: 'text' },
    { column_name: 'workspace_id', data_type: 'text' },
    { column_name: 'name', data_type: 'text' },
    { column_name: 'description', data_type: 'text' },
    { column_name: 'visibility', data_type: 'text' },
    { column_name: 'join_policy', data_type: 'text' },
    { column_name: 'owner_id', data_type: 'text' },
    { column_name: 'status', data_type: 'text' },
    { column_name: 'created_at', data_type: 'timestamp with time zone' },
    { column_name: 'updated_at', data_type: 'timestamp with time zone' },
  ];
  const state = {
    nextConnectError: undefined as Error | undefined,
    projectColumns: undefined as Array<{ column_name: string; data_type: string }> | undefined,
  };
  const clients: Array<{
    config: { connectionString: string };
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }> = [];

  const Client = vi.fn(function PgClientMock(config: { connectionString: string }) {
    const client = {
      config,
      connect: vi.fn(async () => {
        if (state.nextConnectError) {
          throw state.nextConnectError;
        }
      }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: [{ exists: true }] };
        }
        if (sql.includes('information_schema.columns')) {
          return { rows: state.projectColumns ?? requiredProjectColumnRows };
        }
        if (sql.includes('pg_extension')) {
          return { rows: [{ exists: true }] };
        }
        return { rows: [] };
      }),
      end: vi.fn(async () => undefined),
    };
    clients.push(client);
    return client;
  });

  return {
    Client,
    clients,
    readFile: vi.fn(),
    readdir: vi.fn(),
    requiredProjectColumnRows,
    state,
  };
});

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: bootstrapMocks.readFile,
    readdir: bootstrapMocks.readdir,
  },
  readFile: bootstrapMocks.readFile,
  readdir: bootstrapMocks.readdir,
}));

vi.mock('pg', () => ({
  Client: bootstrapMocks.Client,
}));

import {
  getDefaultProductSchemaSqlDir,
  runProductSchemaBootstrap,
  runProductSchemaBootstrapCli,
} from './product-schema-bootstrap.js';

function sqlDirent(name: string, isFile = true): { name: string; isFile: () => boolean } {
  return {
    name,
    isFile: () => isFile,
  };
}

function configureSqlFiles(files: Record<string, string>): void {
  bootstrapMocks.readdir.mockResolvedValue([
    sqlDirent('notes.md'),
    ...Object.keys(files).map((name) => sqlDirent(name)),
    sqlDirent('nested', false),
  ]);
  bootstrapMocks.readFile.mockImplementation(async (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop();
    if (!fileName || !(fileName in files)) {
      throw new Error(`unexpected sql file: ${filePath}`);
    }
    return files[fileName];
  });
}

function createWriter(): { write: ReturnType<typeof vi.fn> } {
  return {
    write: vi.fn(),
  };
}

function writerText(writer: { write: ReturnType<typeof vi.fn> }): string {
  return writer.write.mock.calls.map(([chunk]) => String(chunk)).join('');
}

describe('product schema bootstrap CLI', () => {
  beforeEach(() => {
    bootstrapMocks.Client.mockClear();
    bootstrapMocks.clients.length = 0;
    bootstrapMocks.readFile.mockReset();
    bootstrapMocks.readdir.mockReset();
    bootstrapMocks.state.nextConnectError = undefined;
    bootstrapMocks.state.projectColumns = undefined;
  });

  it('applies repo SQL files by filename and validates projects plus vector extension', async () => {
    configureSqlFiles({
      '020-projects.sql': 'CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY);',
      '010-vector.sql': 'CREATE EXTENSION IF NOT EXISTS vector;',
    });

    const databaseUrl = 'postgres://agent:top-secret-pass@postgres:5432/agentsmith';
    await runProductSchemaBootstrap({
      env: { DATABASE_URL: databaseUrl },
      stdout: createWriter(),
      stderr: createWriter(),
    });

    expect(bootstrapMocks.Client).toHaveBeenCalledWith({ connectionString: databaseUrl });
    expect(bootstrapMocks.clients).toHaveLength(1);
    const client = bootstrapMocks.clients[0];
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);

    const queries = client.query.mock.calls.map(([sql]) => String(sql));
    expect(queries[0]).toBe('CREATE EXTENSION IF NOT EXISTS vector;');
    expect(queries[1]).toBe('CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY);');
    expect(queries[2]).toContain('information_schema.tables');
    expect(queries[3]).toContain('information_schema.columns');
    expect(queries[4]).toContain('pg_extension');
  });

  it('fails when public.projects exists but required schema columns are missing', async () => {
    configureSqlFiles({
      '001-projects.sql': 'CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY);',
    });
    bootstrapMocks.state.projectColumns = bootstrapMocks.requiredProjectColumnRows.filter(
      (column) => column.column_name !== 'workspace_id' && column.column_name !== 'updated_at',
    );

    await expect(runProductSchemaBootstrap({
      env: { DATABASE_URL: 'postgres://agent:pass@postgres:5432/agentsmith' },
      stdout: createWriter(),
      stderr: createWriter(),
    })).rejects.toThrow('public_projects_schema_missing_required_columns:updated_at,workspace_id');

    const client = bootstrapMocks.clients[0];
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('requires DATABASE_URL before connecting', async () => {
    await expect(runProductSchemaBootstrap({
      env: {},
      stdout: createWriter(),
      stderr: createWriter(),
    })).rejects.toThrow('DATABASE_URL');

    expect(bootstrapMocks.Client).not.toHaveBeenCalled();
    expect(bootstrapMocks.readdir).not.toHaveBeenCalled();
  });

  it('sanitizes CLI failures before writing errors', async () => {
    configureSqlFiles({
      '001-projects.sql': 'CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY);',
    });
    const databaseUrl = 'postgres://agent:leaked%20password@postgres:5432/agentsmith';
    const accessKey = 'AKIA-EXAMPLE-ACCESS-KEY';
    const apiKey = 'plain-api-key-value';
    bootstrapMocks.state.nextConnectError = new Error(
      [
        `connect failed for ${databaseUrl}`,
        'dsn postgres://agent:leaked password@postgres:5432/agentsmith',
        'password=leaked password',
        'secret=demo-secret',
        `ACCESS_KEY=${accessKey}`,
        `KEY=${apiKey}`,
      ].join(' '),
    );
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runProductSchemaBootstrapCli({
      env: {
        DATABASE_URL: databaseUrl,
        SERVICE_ACCESS_KEY: accessKey,
        KEY: apiKey,
      },
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(writerText(stdout)).toBe('');
    const errorOutput = writerText(stderr);
    expect(errorOutput).toContain('[product-schema-bootstrap] failed:');
    expect(errorOutput).not.toContain(databaseUrl);
    expect(errorOutput).not.toContain('leaked%20password');
    expect(errorOutput).not.toContain('leaked password');
    expect(errorOutput).not.toContain('demo-secret');
    expect(errorOutput).not.toContain(accessKey);
    expect(errorOutput).not.toContain(apiKey);
    expect(errorOutput).toContain('ACCESS_KEY=<redacted>');
    expect(errorOutput).toContain('KEY=<redacted>');
  });

  it('points the default SQL dir at the repo projects.sql smoke fixture', async () => {
    const actualFs = nodeRequire('node:fs/promises') as FsPromisesModule;
    const projectsSql = await actualFs.readFile(
      `${getDefaultProductSchemaSqlDir()}/projects.sql`,
      'utf8',
    );

    expect(projectsSql).toContain('CREATE TABLE IF NOT EXISTS projects');
    expect(projectsSql).toContain('workspace_id TEXT NOT NULL');
    expect(projectsSql).toContain('updated_at TIMESTAMPTZ NOT NULL');
  });
});
