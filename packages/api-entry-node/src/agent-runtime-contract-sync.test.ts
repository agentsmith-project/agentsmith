import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_CATEGORIES = ['lifecycle', 'progress', 'tool', 'artifact', 'warning', 'error', 'debug'] as const;
const EXPECTED_PHASES = ['start', 'update', 'end'] as const;
const EXPECTED_STATUSES = ['running', 'success', 'error', 'cancelled'] as const;
const EXPECTED_ARTIFACT_TYPES = ['text', 'image', 'file', 'other'] as const;

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

describe('Agent runtime contract sync', () => {
  it('keeps AgentResponseEventPayload enums and raw field aligned with AsyncAPI', async () => {
    const asyncApiPath = path.resolve(process.cwd(), 'docs/contracts/specs/asyncapi.json');
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
    const asyncApiPath = path.resolve(process.cwd(), 'docs/contracts/specs/asyncapi.json');
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
});
