import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS,
  MongoJsonDocStore,
} from '../packages/adapters-private/src/json-doc-store';
import { AgentResourceService } from '../packages/api-entry-node/src/agent-resource-service';

const DEFAULT_MONGO_DB_NAME = 'mbos';
const DEFAULT_MONGO_URL = 'mongodb://mbos:mbos_dev_password@localhost:17017/admin';

function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readJson(filePath: string): unknown {
  const raw = readText(filePath);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function unquoteSimpleEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? inner.replaceAll('\\"', '"').replaceAll('\\\\', '\\')
      : inner.replaceAll("\\'", "'").replaceAll('\\\\', '\\');
  }
  return trimmed;
}

function readSimpleEnvValue(raw: string, key: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    if (trimmed.slice(0, index) !== key) continue;
    return unquoteSimpleEnvValue(trimmed.slice(index + 1));
  }
  return '';
}

function readNestedString(state: unknown, segments: readonly string[]): string {
  let value = state;
  for (const segment of segments) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return '';
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function resolveRuntimePath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

function resolveStateFile(): string {
  const explicit = process.env.BACKEND_REAL_STATE_FILE?.trim();
  if (explicit) return resolveRuntimePath(explicit);
  const stateDir = process.env.BACKEND_REAL_STATE_DIR?.trim();
  if (stateDir) return path.join(resolveRuntimePath(stateDir), 'state.json');
  return path.resolve(process.cwd(), 'artifacts', 'backend-real', 'current', 'state.json');
}

function resolveSummaryFile(): string {
  const explicit = process.env.BACKEND_REAL_SUMMARY_FILE?.trim();
  if (explicit) return resolveRuntimePath(explicit);
  const stateDir = process.env.BACKEND_REAL_STATE_DIR?.trim();
  if (stateDir) return path.join(resolveRuntimePath(stateDir), 'summary.env');
  return path.resolve(process.cwd(), 'artifacts', 'backend-real', 'current', 'summary.env');
}

function assertEnvSafe(value: string, label: string): string {
  if (!value.trim()) {
    throw new Error(`${label}_missing`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

async function main(): Promise<void> {
  const stateFile = resolveStateFile();
  const summaryFile = resolveSummaryFile();
  const state = readJson(stateFile);
  const summary = readText(summaryFile);
  const workspaceId = firstNonEmpty(
    process.env.WORKSPACE_ID,
    readSimpleEnvValue(summary, 'WORKSPACE_ID'),
    readNestedString(state, ['workspace', 'id']),
    'ws_default',
  );
  const projectId = firstNonEmpty(
    process.env.PROJECT_ID,
    readSimpleEnvValue(summary, 'PROJECT_ID'),
    readNestedString(state, ['project', 'id']),
  );
  const runnerId = firstNonEmpty(
    process.env.AGENT_RUNNER_ID,
    readSimpleEnvValue(summary, 'AGENT_RUNNER_ID'),
    readNestedString(state, ['agent_runner', 'id']),
  );
  const developerRunnerKey = firstNonEmpty(
    process.env.AGENT_KEY,
    readSimpleEnvValue(summary, 'AGENT_RUNNER_KEY'),
    readSimpleEnvValue(summary, 'AGENT_KEY'),
  );
  const stateWsUrl = firstNonEmpty(
    process.env.AGENT_WS_URL,
    readSimpleEnvValue(summary, 'AGENT_RUNNER_WS_URL'),
    readSimpleEnvValue(summary, 'WS_URL'),
    readNestedString(state, ['agent_runner', 'ws_url']),
  );

  if (!projectId) {
    throw new Error('managed_runner_project_id_missing');
  }
  if (!runnerId) {
    throw new Error('managed_runner_id_missing');
  }

  const store = new MongoJsonDocStore({
    url: process.env.MONGO_URL?.trim() || DEFAULT_MONGO_URL,
    dbName: process.env.MONGO_DB_NAME?.trim() || DEFAULT_MONGO_DB_NAME,
    mongoClientOptions: DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS,
  });

  try {
    const service = new AgentResourceService(store);
    const runner = await service.getAgent(workspaceId, projectId, runnerId);
    if (!runner) {
      throw new Error('managed_runner_not_found');
    }
    if (runner.runner_provider === 'developer') {
      const wsUrl = stateWsUrl || service.buildConnectionInfo(runner).ws_url;
      process.stdout.write([
        `AGENT_RUNNER_ID=${assertEnvSafe(runner.id, 'agent_runner_id')}`,
        `AGENT_WS_URL=${assertEnvSafe(wsUrl, 'agent_ws_url')}`,
        `AGENT_KEY=${assertEnvSafe(developerRunnerKey, 'agent_key')}`,
        '',
      ].join('\n'));
      return;
    }
    if (runner.runner_provider !== 'managed') {
      throw new Error('managed_runner_expected');
    }
    const rawKey = typeof runner.config?._internal_raw_key === 'string'
      ? runner.config._internal_raw_key.trim()
      : '';
    const wsUrl = stateWsUrl || service.buildConnectionInfo(runner).ws_url;

    process.stdout.write([
      `AGENT_RUNNER_ID=${assertEnvSafe(runner.id, 'agent_runner_id')}`,
      `AGENT_WS_URL=${assertEnvSafe(wsUrl, 'agent_ws_url')}`,
      `AGENT_KEY=${assertEnvSafe(rawKey, 'agent_key')}`,
      '',
    ].join('\n'));
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[resolve-managed-runner-env] ${message}\n`);
  process.exit(1);
});
