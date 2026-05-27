import { describe, expect, it } from 'vitest';
import {
  CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
  MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA,
  PROJECTED_DEPENDENCIES_ENV_FIXTURE,
  PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,
  PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,
  RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS,
  TASK_WORKSPACE_ACCESS_FIXTURE,
  TASK_WORKSPACE_ACCESS_JSON_SCHEMA,
  TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_FIXTURE,
  TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
} from './contract-schema.js';
import {
  CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA as PUBLIC_CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
  MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA as PUBLIC_MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA,
  PROJECTED_DEPENDENCIES_ENV_FIXTURE as PUBLIC_PROJECTED_DEPENDENCIES_ENV_FIXTURE,
  PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA as PUBLIC_PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,
  PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA as PUBLIC_PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,
  RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS as PUBLIC_RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS,
  TASK_WORKSPACE_ACCESS_FIXTURE as PUBLIC_TASK_WORKSPACE_ACCESS_FIXTURE,
  TASK_WORKSPACE_ACCESS_JSON_SCHEMA as PUBLIC_TASK_WORKSPACE_ACCESS_JSON_SCHEMA,
  TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_FIXTURE as PUBLIC_TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_FIXTURE,
  TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA as PUBLIC_TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
} from './index.js';

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  expect(typeof parsed).toBe('object');
  expect(parsed).not.toBeNull();
  expect(Array.isArray(parsed)).toBe(false);
  return parsed as Record<string, unknown>;
}

describe('runner projected dependency env contract truth', () => {
  it('publishes projected dependency env payloads in the runner helper consumption shape', () => {
    expect(PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA).toMatchObject({
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['fields'],
          properties: {
            fields: {
              type: 'object',
              minProperties: 1,
              additionalProperties: {
                type: 'string',
                minLength: 1,
                pattern: '\\S',
              },
            },
          },
        },
        {
          type: 'string',
          minLength: 1,
          pattern: '\\S',
        },
      ],
    });
    expect(PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['dependencies'],
      properties: {
        dependencies: {
          type: 'object',
          minProperties: 1,
        },
      },
    });
    expect(PROJECTED_DEPENDENCIES_ENV_FIXTURE).toMatchObject({
      dependencies: {
        'feishu-managed-user': {
          fields: {
            access_token: 'projected_access_token',
          },
        },
        'jira-auth': {
          fields: {
            base_url: 'https://jira.example.com',
            token: 'projected_jira_token',
          },
        },
      },
    });

    const bulkEnv = parseJsonObject(JSON.stringify(PROJECTED_DEPENDENCIES_ENV_FIXTURE));
    expect(bulkEnv.dependencies).toEqual(PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies);

    const feishuPayload = parseJsonObject(
      JSON.stringify(PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies['feishu-managed-user']),
    );
    expect(feishuPayload).toEqual({
      fields: {
        access_token: 'projected_access_token',
      },
    });
  });

  it('publishes runner-consumed support API projection schemas and fixtures', () => {
    expect(TASK_WORKSPACE_ACCESS_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [
        'task_id',
        'runtime_profile',
        'file_library_id',
        'file_library_name',
        'task_home_binding',
      ],
    });
    expect(TASK_WORKSPACE_ACCESS_FIXTURE.task_home_binding).toMatchObject({
      provider: 'afscp',
      mode: 'pre_mounted',
      paths: {
        task_home_path: '/home/task_1',
        workspace_path: '/home/task_1/workspace',
        artifacts_path: '/home/task_1/workspace/.artifacts',
        library_root_path: '.',
      },
    });
    expect(TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [
        'holder_id',
        'file_library_id',
        'binding_generation',
        'lease_epoch',
      ],
    });
    expect(TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA.properties.binding_generation).toMatchObject({
      type: 'string',
      minLength: 1,
      pattern: '^[1-9][0-9]*$',
    });
    expect(TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_FIXTURE).toEqual({
      holder_id: 'holder_1',
      file_library_id: 'flib_1',
      binding_generation: '7',
      lease_epoch: 'lease_1',
    });
    expect(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'scope', 'key', 'content', 'content_type', 'read_only', 'updated_at', 'updated_by'],
    });
    expect(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA.properties.scope).not.toHaveProperty('enum');
    expect(MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [
        'connection_id',
        'provider',
        'kind',
        'display_name',
        'workspace_id',
        'status',
        'fields',
        'scopes',
        'expires_at',
        'updated_at',
        'provenance',
      ],
    });
  });

  it('keeps rejected product semantics and retired raw secret fields out of the support API projection contract', () => {
    const serialized = JSON.stringify({
      TASK_WORKSPACE_ACCESS_JSON_SCHEMA,
      TASK_WORKSPACE_ACCESS_FIXTURE,
      TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
      TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_FIXTURE,
      CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
      MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA,
      PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,
      PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,
      PROJECTED_DEPENDENCIES_ENV_FIXTURE,
    });

    for (const rejected of RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS) {
      expect(serialized).not.toContain(rejected);
    }
  });

  it('exports runner support projection schemas and fixtures through the public package entrypoint', () => {
    expect(PUBLIC_PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA).toBe(
      PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,
    );
    expect(PUBLIC_PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA).toBe(
      PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,
    );
    expect(PUBLIC_PROJECTED_DEPENDENCIES_ENV_FIXTURE).toBe(
      PROJECTED_DEPENDENCIES_ENV_FIXTURE,
    );
    expect(PUBLIC_TASK_WORKSPACE_ACCESS_JSON_SCHEMA).toBe(TASK_WORKSPACE_ACCESS_JSON_SCHEMA);
    expect(PUBLIC_TASK_WORKSPACE_ACCESS_FIXTURE).toBe(TASK_WORKSPACE_ACCESS_FIXTURE);
    expect(PUBLIC_TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA).toBe(
      TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
    );
    expect(PUBLIC_TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_FIXTURE).toBe(
      TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_FIXTURE,
    );
    expect(PUBLIC_CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA).toBe(
      CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
    );
    expect(PUBLIC_MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA).toBe(
      MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA,
    );
    expect(PUBLIC_RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS).toBe(
      RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS,
    );
  });
});
