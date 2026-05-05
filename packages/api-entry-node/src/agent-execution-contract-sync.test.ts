import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_CATEGORIES = ['lifecycle', 'progress', 'tool', 'artifact', 'warning', 'error', 'debug'] as const;
const EXPECTED_PHASES = ['start', 'update', 'end'] as const;
const EXPECTED_STATUSES = ['running', 'success', 'error', 'cancelled'] as const;
const EXPECTED_ARTIFACT_TYPES = ['text', 'image', 'file', 'other'] as const;
const EXPECTED_AGENT_WIRE_APIS = [
  'openai_chat_completions',
  'openai_responses',
  'anthropic_messages',
] as const;

async function resolveAsyncApiSpecPath(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), 'docs/contracts/specs/asyncapi.json'),
    path.resolve(process.cwd(), '../../docs/contracts/specs/asyncapi.json'),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error('asyncapi_spec_not_found');
}

async function resolveOpenApiSpecPath(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), 'docs/contracts/specs/openapi.json'),
    path.resolve(process.cwd(), '../../docs/contracts/specs/openapi.json'),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error('openapi_spec_not_found');
}

function readPropertySchema(
  asyncApi: Record<string, unknown>,
  propertyName: string,
): Record<string, unknown> | null {
  const components = (asyncApi.components ?? {}) as Record<string, unknown>;
  const schemas = (components.schemas ?? {}) as Record<string, unknown>;
  const payload = (schemas.AgentResponseEventPayload ?? {}) as Record<string, unknown>;
  const properties = (payload.properties ?? {}) as Record<string, unknown>;
  const prop = properties[propertyName];
  return typeof prop === 'object' && prop !== null ? (prop as Record<string, unknown>) : null;
}

function readSchema(
  asyncApi: Record<string, unknown>,
  schemaName: string,
): Record<string, unknown> | null {
  const components = (asyncApi.components ?? {}) as Record<string, unknown>;
  const schemas = (components.schemas ?? {}) as Record<string, unknown>;
  const schema = schemas[schemaName];
  return typeof schema === 'object' && schema !== null ? (schema as Record<string, unknown>) : null;
}

function readNestedPropertySchema(
  schema: Record<string, unknown> | null,
  pathParts: string[],
): Record<string, unknown> | null {
  let current: Record<string, unknown> | null = schema;
  for (const part of pathParts) {
    const properties = (current?.properties ?? {}) as Record<string, unknown>;
    const next = properties[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      return null;
    }
    current = next as Record<string, unknown>;
  }
  return current;
}

function readMessagePayloadSchema(
  asyncApi: Record<string, unknown>,
  messageName: string,
): Record<string, unknown> | null {
  const components = (asyncApi.components ?? {}) as Record<string, unknown>;
  const messages = (components.messages ?? {}) as Record<string, unknown>;
  const message = messages[messageName];
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return null;
  }
  const payload = (message as Record<string, unknown>).payload;
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
}

describe('Agent execution contract sync', () => {
  it('publishes Agent Runner OpenAPI object and operation names without legacy Agent schema aliases', async () => {
    const openApiPath = await resolveOpenApiSpecPath();
    const raw = await fs.readFile(openApiPath, 'utf-8');
    const openApi = JSON.parse(raw) as Record<string, unknown>;
    const components = (openApi.components ?? {}) as Record<string, unknown>;
    const schemas = (components.schemas ?? {}) as Record<string, unknown>;
    const paths = (openApi.paths ?? {}) as Record<string, unknown>;
    const agentRunnerPath = paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/agent-runners'] as
      | Record<string, unknown>
      | undefined;
    const agentRunnerItemPath = paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/agent-runners/{agentRunnerId}'] as
      | Record<string, unknown>
      | undefined;

    expect(schemas.AgentRunner).toBeTruthy();
    expect(schemas.Agent).toBeUndefined();
    expect((agentRunnerPath?.get as { operationId?: string } | undefined)?.operationId).toBe('listAgentRunners');
    expect((agentRunnerPath?.post as { operationId?: string } | undefined)?.operationId).toBe('createAgentRunner');
    expect((agentRunnerItemPath?.get as { operationId?: string } | undefined)?.operationId).toBe('getAgentRunner');
    expect((agentRunnerItemPath?.patch as { operationId?: string } | undefined)?.operationId).toBe('updateAgentRunner');
    expect((agentRunnerItemPath?.delete as { operationId?: string } | undefined)?.operationId).toBe('deleteAgentRunner');
    expect(raw).not.toContain('#/components/schemas/Agent"');
    expect(raw).not.toContain('"operationId":"listAgents"');
  });

  it('keeps AgentResponseEventPayload enums and raw field aligned with AsyncAPI', async () => {
    const asyncApiPath = await resolveAsyncApiSpecPath();
    const raw = await fs.readFile(asyncApiPath, 'utf-8');
    const asyncApi = JSON.parse(raw) as Record<string, unknown>;

    const categorySchema = readPropertySchema(asyncApi, 'category');
    const phaseSchema = readPropertySchema(asyncApi, 'phase');
    const statusSchema = readPropertySchema(asyncApi, 'status');
    const detailsSchema = readPropertySchema(asyncApi, 'details');
    const rawSchema = readPropertySchema(asyncApi, 'raw');

    expect(categorySchema?.enum).toEqual([...EXPECTED_CATEGORIES]);
    expect(phaseSchema?.enum).toEqual([...EXPECTED_PHASES]);
    expect(statusSchema?.enum).toEqual([...EXPECTED_STATUSES]);
    expect(detailsSchema?.type).toBe('object');
    expect(rawSchema?.type).toBe('string');
  });

  it('keeps AgentResponseArtifactPayload shape aligned with AsyncAPI', async () => {
    const asyncApiPath = await resolveAsyncApiSpecPath();
    const raw = await fs.readFile(asyncApiPath, 'utf-8');
    const asyncApi = JSON.parse(raw) as Record<string, unknown>;

    const payloadSchema = readSchema(asyncApi, 'AgentResponseArtifactPayload');
    const properties = (payloadSchema?.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(payloadSchema?.required) ? payloadSchema?.required : [];
    const artifactTypeSchema =
      typeof properties.artifact_type === 'object' && properties.artifact_type !== null
        ? (properties.artifact_type as Record<string, unknown>)
        : null;
    const fileSizeSchema =
      typeof properties.file_size === 'object' && properties.file_size !== null
        ? (properties.file_size as Record<string, unknown>)
        : null;

    expect(required).toEqual(['filename', 'task_relative_path', 'artifact_type']);
    expect((properties.filename as { type?: unknown })?.type).toBe('string');
    expect((properties.task_relative_path as { type?: unknown })?.type).toBe('string');
    expect(artifactTypeSchema?.enum).toEqual([...EXPECTED_ARTIFACT_TYPES]);
    expect((properties.mime_type as { type?: unknown })?.type).toBe('string');
    expect(fileSizeSchema?.type).toBe('integer');
    expect(fileSizeSchema?.minimum).toBe(0);
    expect((properties.title as { type?: unknown })?.type).toBe('string');
    expect((properties.content as { type?: unknown })?.type).toBe('string');
    expect((properties.thumbnail_url as { type?: unknown })?.type).toBe('string');
  });

  it('keeps TaskExecutionContext wire_api aligned with canonical endpoint upstream protocols', async () => {
    const asyncApiPath = await resolveAsyncApiSpecPath();
    const raw = await fs.readFile(asyncApiPath, 'utf-8');
    const asyncApi = JSON.parse(raw) as Record<string, unknown>;

    const startEnvelope = readMessagePayloadSchema(asyncApi, 'serverRequestStart');
    const wireApiSchema = readNestedPropertySchema(startEnvelope, ['payload', 'execution_context', 'wire_api']);

    expect(wireApiSchema?.enum).toEqual([...EXPECTED_AGENT_WIRE_APIS]);
  });
});
