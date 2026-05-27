import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
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
} from '@mbos/agent-runner-contract';
import {
  RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS as ADAPTER_REJECTED_PRODUCT_SEMANTICS,
  TASK_WORKSPACE_ACCESS_JSON_SCHEMA as ADAPTER_TASK_WORKSPACE_ACCESS_JSON_SCHEMA,
  TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA as ADAPTER_TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
} from './runner-support-api-projection-contract';
import {
  checkRunnerSupportApiProjectionFiles,
  checkRunnerSupportApiProjectionArtifact,
  checkRunnerSupportApiProjections,
  formatRunnerSupportApiProjectionErrors,
} from './check-runner-support-api-projections';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createOpenApiFixture(options: {
  workspaceAccessSchema?: Record<string, unknown>;
  releaseRequestSchema?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    paths: {
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/workspace-access': {
        post: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: options.workspaceAccessSchema
                    ?? cloneJson(TASK_WORKSPACE_ACCESS_JSON_SCHEMA),
                },
              },
            },
          },
        },
      },
      '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/workspace-access/release': {
        post: {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: options.releaseRequestSchema
                  ?? cloneJson(TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA),
              },
            },
          },
        },
      },
    },
  };
}

describe('check-runner-support-api-projections', () => {
  it('passes when OpenAPI workspace-access schemas match the runner package contract', () => {
    expect(checkRunnerSupportApiProjections(createOpenApiFixture()).errors).toEqual([]);
  });

  it('passes against the real checked-in OpenAPI JSON', () => {
    const openApi = JSON.parse(
      readFileSync(path.join(process.cwd(), 'docs/contracts/specs/openapi.json'), 'utf8'),
    ) as unknown;

    expect(checkRunnerSupportApiProjections(openApi).errors).toEqual([]);
  });

  it('passes against the real checked-in OpenAPI YAML', () => {
    const openApi = YAML.parse(
      readFileSync(path.join(process.cwd(), 'docs/contracts/specs/openapi.yaml'), 'utf8'),
    ) as unknown;

    expect(checkRunnerSupportApiProjections(openApi).errors).toEqual([]);
  });

  it('checks JSON and YAML files and rejects YAML-only drift', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'runner-support-openapi-'));
    try {
      const validJsonPath = path.join(tempDir, 'openapi.json');
      const driftYamlPath = path.join(tempDir, 'openapi.yaml');
      const releaseRequestSchema = cloneJson(
        TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
      ) as Record<string, unknown>;
      const releaseRequestProperties = releaseRequestSchema.properties as Record<string, Record<string, unknown>>;
      releaseRequestProperties.binding_generation.pattern = '^\\d+$';

      writeFileSync(validJsonPath, JSON.stringify(createOpenApiFixture()), 'utf8');
      writeFileSync(
        driftYamlPath,
        YAML.stringify(createOpenApiFixture({ releaseRequestSchema })),
        'utf8',
      );

      const result = checkRunnerSupportApiProjectionFiles([validJsonPath, driftYamlPath]);

      expect(result.errors).toEqual([
        expect.objectContaining({
          code: 'workspace_access_release_schema_mismatch',
          path: expect.stringContaining(
            'openapi.yaml:paths./api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/workspace-access/release.post.requestBody.content.application/json.schema.properties.binding_generation.pattern',
          ),
          message: expect.stringContaining(
            'workspace-access release request schema differs from runner support projection contract at properties.binding_generation.pattern',
          ),
        }),
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses producer-owned support API schemas from the runner package contract', () => {
    expect(ADAPTER_TASK_WORKSPACE_ACCESS_JSON_SCHEMA).toBe(TASK_WORKSPACE_ACCESS_JSON_SCHEMA);
    expect(ADAPTER_TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA).toBe(
      TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
    );
    expect(ADAPTER_REJECTED_PRODUCT_SEMANTICS).toBe(
      RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS,
    );
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
    expect(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA.properties.scope).toMatchObject({
      type: 'string',
      minLength: 1,
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

  it('rejects workspace-access response schema drift and retired raw secret fields', () => {
    const schema = cloneJson(TASK_WORKSPACE_ACCESS_JSON_SCHEMA) as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    properties.user_bearer_token = { type: 'string' };
    properties.credential_files = { type: 'array' };

    const result = checkRunnerSupportApiProjections(createOpenApiFixture({
      workspaceAccessSchema: schema,
    }));

    expect(result.errors).toEqual([
      {
        code: 'support_projection_forbidden_product_semantics',
        path: 'paths./api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/workspace-access.post.responses.200.content.application/json.schema.properties',
        message: 'workspace-access response schema contains fields forbidden from runner package support API projection contract: credential_files, user_bearer_token',
      },
    ]);
    expect(formatRunnerSupportApiProjectionErrors(result.errors)).toContain('user_bearer_token');
  });

  it('rejects workspace-access response shape drift from the contract schema', () => {
    const schema = cloneJson(TASK_WORKSPACE_ACCESS_JSON_SCHEMA) as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    properties.runtime_profile.enum = ['managed'];

    const result = checkRunnerSupportApiProjections(createOpenApiFixture({
      workspaceAccessSchema: schema,
    }));

    expect(result.errors).toEqual([
      {
        code: 'workspace_access_schema_mismatch',
        path: 'paths./api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/workspace-access.post.responses.200.content.application/json.schema.properties.runtime_profile.enum.length',
        message: 'workspace-access response schema differs from runner support projection contract at properties.runtime_profile.enum.length: expected 2, got 1',
      },
    ]);
  });

  it('rejects workspace-access schemas that omit explicit additionalProperties false', () => {
    const schema = cloneJson(TASK_WORKSPACE_ACCESS_JSON_SCHEMA) as Record<string, unknown>;
    delete schema.additionalProperties;

    const result = checkRunnerSupportApiProjections(createOpenApiFixture({
      workspaceAccessSchema: schema,
    }));

    expect(result.errors).toEqual([
      {
        code: 'workspace_access_schema_mismatch',
        path: 'paths./api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/workspace-access.post.responses.200.content.application/json.schema.additionalProperties',
        message: 'workspace-access response schema differs from runner support projection contract at additionalProperties: expected false, got undefined',
      },
    ]);
  });

  it('rejects workspace-access release request drift from the contract schema', () => {
    const schema = cloneJson(TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA) as Record<string, unknown>;
    schema.required = ['holder_id'];

    const result = checkRunnerSupportApiProjections(createOpenApiFixture({
      releaseRequestSchema: schema,
    }));

    expect(result.errors).toEqual([
      {
        code: 'workspace_access_release_schema_mismatch',
        path: 'paths./api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/workspace-access/release.post.requestBody.content.application/json.schema.required.length',
        message: 'workspace-access release request schema differs from runner support projection contract at required.length: expected 4, got 1',
      },
    ]);
  });

  it('keeps projected dependency env artifact truth in the runner env payload shape', () => {
    expect(PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA.oneOf).toHaveLength(2);
    expect(PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['dependencies'],
    });
    expect(PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies['feishu-managed-user']).toEqual({
      fields: {
        access_token: 'projected_access_token',
      },
    });
    expect(PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies['jira-auth']).toEqual({
      fields: {
        base_url: 'https://jira.example.com',
        token: 'projected_jira_token',
      },
    });
  });

  it('rejects product semantics inside the contract support projection artifact', () => {
    const result = checkRunnerSupportApiProjectionArtifact({
      PROJECTED_DEPENDENCIES_ENV_FIXTURE: {
        kind: 'context_store',
        scopes: ['member', 'task'],
        writable_scopes: ['member'],
      },
      stale: {
        managed_credential_refresh: true,
      },
    });

    expect(result.errors).toEqual([
      {
        code: 'support_projection_forbidden_product_semantics',
        path: 'PROJECTED_DEPENDENCIES_ENV_FIXTURE.kind',
        message: 'runner support projection artifact must not expose product semantics: context_store',
      },
      {
        code: 'support_projection_forbidden_product_semantics',
        path: 'PROJECTED_DEPENDENCIES_ENV_FIXTURE.writable_scopes',
        message: 'runner support projection artifact must not expose product semantics: writable_scopes',
      },
      {
        code: 'support_projection_forbidden_product_semantics',
        path: 'stale.managed_credential_refresh',
        message: 'runner support projection artifact must not expose product semantics: managed_credential_refresh',
      },
    ]);
  });

  it('keeps product semantics and retired raw secret fields out of the package support API projection contract', () => {
    const serialized = JSON.stringify({
      TASK_WORKSPACE_ACCESS_JSON_SCHEMA,
      TASK_WORKSPACE_ACCESS_FIXTURE,
      TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
      MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA,
      CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
      PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,
      PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,
      PROJECTED_DEPENDENCIES_ENV_FIXTURE,
    });

    for (const rejected of RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS) {
      expect(serialized).not.toContain(rejected);
    }
  });

  it('is exposed as an npm contract gate and wired into contracts:check', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts['contracts:check-runner-support-api-projections']).toBe(
      'npm run build -w @mbos/agent-runner-contract && tsx scripts/contracts/check-runner-support-api-projections.ts',
    );
    expect(scripts['contracts:check']).toContain(
      'npm run contracts:check-runner-support-api-projections',
    );
  });
});
