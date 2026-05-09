import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  AgentTaskDeleteBlockedErrorSchema,
  AgentTaskFileLibraryInUseErrorSchema,
  AgentTaskWorkspaceBindingConflictErrorSchema,
  CreateTaskRequestSchema,
  FileLibrarySchema,
  FileLibraryTaskInUseErrorSchema,
} from './index';

const baseFileLibrary = {
  id: 'lib_a',
  workspace_id: 'ws_default',
  project_id: 'proj_001',
  name: 'Workspace A',
  description: 'Task HOME workspace',
  status: 'ready',
  filesystem_name: 'flib_ws_default_proj_001_lib_a',
  created_by_user_id: 'user_001',
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
};

describe('agent task persistent HOME contracts', () => {
  it('accepts the CreateTask workspace_mode matrix for create_new and use_existing', () => {
    expect(CreateTaskRequestSchema.safeParse({
      title: 'Fresh task',
    }).success).toBe(true);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Fresh task',
      workspace_mode: 'create_new',
    }).success).toBe(true);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Reuse workspace',
      workspace_mode: 'use_existing',
      workspace_file_library_id: 'lib_released',
    }).success).toBe(true);
  });

  it('rejects invalid CreateTask workspace_mode combinations before backend execution', () => {
    expect(CreateTaskRequestSchema.safeParse({
      title: 'Invalid implicit create_new',
      workspace_file_library_id: 'lib_a',
    }).success).toBe(false);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Invalid explicit create_new',
      workspace_mode: 'create_new',
      workspace_file_library_id: 'lib_a',
    }).success).toBe(false);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Missing existing library',
      workspace_mode: 'use_existing',
    }).success).toBe(false);

    expect(CreateTaskRequestSchema.safeParse({
      title: 'Unknown mode',
      workspace_mode: 'reuse_any',
      workspace_file_library_id: 'lib_a',
    }).success).toBe(false);
  });

  it('requires safe task HOME binding fields on FileLibrary DTOs', () => {
    expect(FileLibrarySchema.parse({
      ...baseFileLibrary,
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
    })).toMatchObject({
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
    });

    expect(FileLibrarySchema.parse({
      ...baseFileLibrary,
      task_home_binding_status: 'bound',
      bound_task_visible: true,
      bound_task_id: 'task_archived',
      bound_task_title: 'Archived task',
      bound_task_status: 'archived',
    })).toMatchObject({
      task_home_binding_status: 'bound',
      bound_task_visible: true,
      bound_task_status: 'archived',
    });
  });

  it('rejects redacted FileLibrary DTOs that leak bound task metadata', () => {
    const parsed = FileLibrarySchema.safeParse({
      ...baseFileLibrary,
      task_home_binding_status: 'bound',
      bound_task_visible: false,
      bound_task_title: 'Secret task',
      bound_task_status: 'active',
    });

    expect(parsed.success).toBe(false);
  });

  it('parses typed binding conflict errors with only display-safe fields', () => {
    expect(AgentTaskFileLibraryInUseErrorSchema.parse({
      error_code: 'AGENT_TASK_FILE_LIBRARY_IN_USE',
      message: 'workspace_file_library_in_use',
      field: 'workspace_file_library_id',
      file_library_id: 'lib_a',
      bound_task_visible: false,
    })).toMatchObject({
      bound_task_visible: false,
    });

    expect(FileLibraryTaskInUseErrorSchema.parse({
      error_code: 'FILE_LIBRARY_TASK_IN_USE',
      message: 'file_library_task_in_use',
      file_library_id: 'lib_a',
      bound_task_visible: true,
      bound_task_id: 'task_archived',
      bound_task_title: 'Archived task',
      bound_task_status: 'archived',
    })).toMatchObject({
      bound_task_status: 'archived',
    });

    expect(FileLibraryTaskInUseErrorSchema.safeParse({
      error_code: 'FILE_LIBRARY_TASK_IN_USE',
      message: 'file_library_task_in_use',
      file_library_id: 'lib_a',
      bound_task_visible: false,
      bound_task_title: 'Secret task',
    }).success).toBe(false);
  });

  it('keeps task delete and workspace binding conflict error fences contract-safe', () => {
    expect(AgentTaskDeleteBlockedErrorSchema.parse({
      error_code: 'AGENT_TASK_DELETE_BLOCKED',
      message: 'agent_task_delete_blocked',
      task_id: 'task_busy',
      blockers: ['active_run', 'active_terminal'],
    })).toMatchObject({
      task_id: 'task_busy',
      blockers: ['active_run', 'active_terminal'],
    });

    expect(AgentTaskWorkspaceBindingConflictErrorSchema.parse({
      error_code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      message: 'agent_task_workspace_binding_conflict',
      task_id: 'task_stale',
      file_library_id: 'lib_a',
      binding_generation: '1778300000000001',
      lease_epoch: 'lease_1',
      holder_id: 'holder_1',
    })).toMatchObject({
      binding_generation: '1778300000000001',
      lease_epoch: 'lease_1',
      holder_id: 'holder_1',
    });
  });

  it('keeps OpenAPI task binding conflict schemas satisfiable and strict without allOf traps', () => {
    const openapiPath = [
      resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'),
      resolve(process.cwd(), '../../docs/contracts/specs/openapi.yaml'),
    ].find((candidate) => existsSync(candidate));
    if (!openapiPath) {
      throw new Error('openapi.yaml not found from contract test cwd');
    }
    const openapi = parse(readFileSync(openapiPath, 'utf8')) as {
      components?: { schemas?: Record<string, Record<string, unknown>> };
    };
    const schemas = openapi.components?.schemas ?? {};

    for (const schemaName of ['AgentTaskFileLibraryInUseError', 'FileLibraryTaskInUseError']) {
      const schema = schemas[schemaName];
      expect(schema).toBeTruthy();
      expect(schema.allOf).toBeUndefined();
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties).toMatchObject({
        bound_task_visible: { type: 'boolean' },
        bound_task_id: { type: 'string' },
        bound_task_title: { type: 'string' },
      });
      expect(schema.required).toEqual(expect.arrayContaining([
        'error_code',
        'message',
        'file_library_id',
        'bound_task_visible',
      ]));
    }
    expect(schemas.AgentTaskDeleteBlockedError?.properties).toMatchObject({
      task_id: { type: 'string' },
      blockers: {
        type: 'array',
        items: { type: 'string' },
      },
    });
    expect(schemas.AgentTaskWorkspaceBindingConflictError?.properties).toMatchObject({
      binding_generation: { type: 'string' },
      lease_epoch: { type: 'string' },
      holder_id: { type: 'string' },
    });
  });

  it('keeps typed error branches disjoint from ApiError fallback branches', () => {
    const openapiPath = [
      resolve(process.cwd(), 'docs/contracts/specs/openapi.yaml'),
      resolve(process.cwd(), '../../docs/contracts/specs/openapi.yaml'),
    ].find((candidate) => existsSync(candidate));
    if (!openapiPath) {
      throw new Error('openapi.yaml not found from contract test cwd');
    }
    const openapi = parse(readFileSync(openapiPath, 'utf8')) as {
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, Record<string, unknown>> };
    };
    const schemas = openapi.components?.schemas ?? {};
    const apiErrorSchema = schemas.ApiError;
    const apiErrorCodes = readErrorCodeEnum(apiErrorSchema, schemas);

    expect(apiErrorSchema).toBeTruthy();
    expect(apiErrorSchema.additionalProperties).toBe(false);

    const overlaps: string[] = [];
    for (const response of findOneOfResponsesWithApiError(openapi.paths ?? {})) {
      for (const schemaName of response.schemaNames) {
        if (schemaName === 'ApiError') continue;
        const typedCodes = readErrorCodeEnum(schemas[schemaName], schemas);
        for (const code of typedCodes) {
          if (apiErrorCodes.includes(code)) {
            overlaps.push(`${response.path} ${response.method} ${response.status} ${schemaName}.${code}`);
          }
        }
      }
    }

    expect(overlaps).toEqual([]);
  });
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRefSchemaName(value: unknown): string | null {
  const ref = asRecord(value)?.$ref;
  if (typeof ref !== 'string') return null;
  const match = ref.match(/^#\/components\/schemas\/(.+)$/);
  return match?.[1] ?? null;
}

function readStringEnum(value: unknown): string[] {
  const enumValues = asRecord(value)?.enum;
  return Array.isArray(enumValues)
    ? enumValues.filter((item): item is string => typeof item === 'string')
    : [];
}

function readErrorCodeEnum(
  schema: Record<string, unknown> | undefined,
  schemas: Record<string, Record<string, unknown>>,
): string[] {
  const errorCode = asRecord(asRecord(schema?.properties)?.error_code);
  const directEnum = readStringEnum(errorCode);
  if (directEnum.length > 0) return directEnum;

  const refName = readRefSchemaName(errorCode);
  if (!refName) return [];
  return readStringEnum(schemas[refName]);
}

function findOneOfResponsesWithApiError(paths: Record<string, unknown>): Array<{
  path: string;
  method: string;
  status: string;
  schemaNames: string[];
}> {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  const matches: Array<{
    path: string;
    method: string;
    status: string;
    schemaNames: string[];
  }> = [];

  for (const [path, pathItemValue] of Object.entries(paths)) {
    const pathItem = asRecord(pathItemValue);
    if (!pathItem) continue;
    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!methods.has(method)) continue;
      const responses = asRecord(asRecord(operationValue)?.responses);
      if (!responses) continue;
      for (const [status, responseValue] of Object.entries(responses)) {
        const schema = asRecord(
          asRecord(
            asRecord(
              asRecord(responseValue)?.content,
            )?.['application/json'],
          )?.schema,
        );
        const oneOf = schema?.oneOf;
        if (!Array.isArray(oneOf)) continue;
        const schemaNames = oneOf
          .map(readRefSchemaName)
          .filter((name): name is string => typeof name === 'string');
        if (schemaNames.includes('ApiError')) {
          matches.push({ path, method, status, schemaNames });
        }
      }
    }
  }

  return matches;
}
