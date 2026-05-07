import fs from 'node:fs';
import path from 'node:path';
import { upsertDeploymentDefaultManagedRunner } from './agent-runner-seed-managed-runner-core';

const DEFAULT_MONGO_DB_NAME = 'mbos';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`missing required env: ${name}`);
  }
  return value;
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function readNestedString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const current = (value as Record<string, unknown>)[key];
  return typeof current === 'string' ? current : '';
}

function stateRoot(): string {
  return process.env.BACKEND_REAL_STATE_DIR?.trim()
    || path.join(process.cwd(), 'artifacts', 'backend-real', 'current');
}

async function main(): Promise<void> {
  const workspaceId = process.env.WORKSPACE_ID?.trim() || 'ws_default';
  const projectId = required('PROJECT_ID');
  const endpointId = required('ENDPOINT_ID');
  const runnerName = process.env.AGENT_RUNNER_NAME?.trim() || `codex-agent-task-runner-${Date.now()}`;
  const mongoUrl = required('MONGO_URL');
  const mongoDbName = process.env.MONGO_DB_NAME?.trim() || DEFAULT_MONGO_DB_NAME;
  const root = stateRoot();
  const stateFile = process.env.BACKEND_REAL_STATE_FILE?.trim() || path.join(root, 'state.json');
  const summaryFile = process.env.BACKEND_REAL_SUMMARY_FILE?.trim() || path.join(root, 'summary.env');

  if (!process.env.AGENT_EXECUTION_WS_BASE_URL?.trim() && process.env.API_BASE?.trim()) {
    process.env.AGENT_EXECUTION_WS_BASE_URL = process.env.API_BASE.trim()
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:');
  }
  if (
    !process.env.AGENT_EXECUTION_WS_BASE_URL?.trim()
    && !process.env.AGENT_EXECUTION_HTTP_BASE_URL?.trim()
    && !process.env.INTERNAL_API_BASE_URL?.trim()
  ) {
    throw new Error('missing managed runner internal api base env');
  }

  const state = readJson(stateFile);
  const seedResult = await upsertDeploymentDefaultManagedRunner({
    workspaceId,
    projectId,
    endpointId,
    runnerName,
    mongoUrl,
    mongoDbName,
  });

  const endpoint = (state as Record<string, unknown>).endpoint;
  const credential = (state as Record<string, unknown>).credential;
  fs.writeFileSync(
    summaryFile,
    [
      `STATE_DIR=${root}`,
      `STATE_FILE=${stateFile}`,
      `TOKEN_FILE=${path.join(root, 'token.txt')}`,
      `WORKSPACE_ID=${workspaceId}`,
      `PROJECT_ID=${projectId}`,
      `CREDENTIAL_ID=${readNestedString(credential, 'id')}`,
      `ENDPOINT_ID=${endpointId}`,
      `AGENT_RUNNER_ID=${seedResult.runnerId}`,
      `AGENT_RUNNER_STATUS=${seedResult.status}`,
      `AGENT_RUNNER_DEFAULT_ENDPOINT_ID=${seedResult.defaultEndpointId ?? ''}`,
      `AGENT_TASK_MODEL_SETTING_ENDPOINT_ID=${seedResult.agentTaskModelSetting.endpointId}`,
      `AGENT_TASK_MODEL_SETTING_DEFAULT_MODEL=${seedResult.agentTaskModelSetting.defaultModelId}`,
      `AGENT_TASK_MODEL_SETTING_REVISION=${seedResult.agentTaskModelSetting.settingRevision}`,
      `AGENT_RUNNER_WS_URL=${seedResult.wsUrl}`,
      `WS_URL=${seedResult.wsUrl}`,
      `PRESET_ANTHROPIC_ENDPOINT_BASE_URL=${readNestedString(endpoint, 'base_url')}`,
      `PRESET_ENDPOINT_MODEL=${readNestedString(endpoint, 'model')}`,
      `PRESET_ANTHROPIC_ENDPOINT_PROTOCOL=${readNestedString(endpoint, 'upstream_protocol')}`,
      '',
    ].join('\n'),
  );

  process.stdout.write(`${JSON.stringify({
    project_id: projectId,
    agent_runner_id: seedResult.runnerId,
    default_endpoint_id: seedResult.defaultEndpointId,
    agent_task_model_setting: {
      endpoint_id: seedResult.agentTaskModelSetting.endpointId,
      default_model_id: seedResult.agentTaskModelSetting.defaultModelId,
      setting_revision: seedResult.agentTaskModelSetting.settingRevision,
      updated: seedResult.agentTaskModelSetting.updated,
    },
    ws_url: seedResult.wsUrl,
  }, null, 2)}\n`);
}

if (import.meta.url === `file://${path.resolve(process.argv[1] || '')}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[seed-managed-runner] ${message}\n`);
    process.exit(1);
  });
}
