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

const CONTEXT_SCOPE_QUERY_ENUM = ['member', 'task', 'project_member', 'project', 'workspace'] as const;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function readResponseJsonSchema(input: {
  openApi: unknown;
  path: string;
  method: string;
}): Record<string, unknown> | null {
  const paths = readRecord(input.openApi, 'paths');
  const route = readRecord(paths, input.path);
  const operation = readRecord(route, input.method);
  const responses = readRecord(operation, 'responses');
  const ok = readRecord(responses, '200');
  const content = readRecord(ok, 'content');
  const json = readRecord(content, 'application/json');
  return readRecord(json, 'schema');
}

function expectNoForbiddenSupportProjectionFields(schema: unknown): void {
  const serialized = JSON.stringify(schema);
  for (const rejected of RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS) {
    expect(serialized).not.toContain(rejected);
  }
}

function createContextListResponseSchema(
  itemSchema: Record<string, unknown> = cloneJson(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA),
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total'],
    properties: {
      items: {
        type: 'array',
        items: itemSchema,
      },
      total: {
        type: 'integer',
        minimum: 0,
      },
    },
  };
}

function createContextScopeQueryParameter(): Record<string, unknown> {
  return {
    name: 'scope',
    in: 'query',
    required: true,
    schema: {
      type: 'string',
      enum: [...CONTEXT_SCOPE_QUERY_ENUM],
    },
  };
}

function readGetScopeQueryParameterSchema(openApi: unknown, apiPath: string): Record<string, unknown> {
  const paths = readRecord(openApi, 'paths');
  const route = readRecord(paths, apiPath);
  const get = readRecord(route, 'get');
  const parameters = get?.parameters;
  expect(Array.isArray(parameters)).toBe(true);
  const scopeParameter = (parameters as unknown[]).find((parameter) => (
    isRecord(parameter)
    && parameter.name === 'scope'
    && parameter.in === 'query'
  ));
  const schema = readRecord(scopeParameter, 'schema');
  expect(schema).not.toBeNull();
  return schema as Record<string, unknown>;
}

function createOpenApiFixture(options: {
  workspaceAccessSchema?: Record<string, unknown>;
  releaseRequestSchema?: Record<string, unknown>;
  contextSchema?: Record<string, unknown>;
  contextListItemSchema?: Record<string, unknown>;
  managedCredentialRefreshSchema?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    paths: {
      '/api/v1/context': {
        get: {
          parameters: [
            createContextScopeQueryParameter(),
            {
              name: 'key',
              in: 'query',
              required: true,
              schema: {
                type: 'string',
                minLength: 1,
              },
            },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: options.contextSchema
                    ?? cloneJson(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA),
                },
              },
            },
          },
        },
      },
      '/api/v1/context/list': {
        get: {
          parameters: [
            createContextScopeQueryParameter(),
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: createContextListResponseSchema(options.contextListItemSchema),
                },
              },
            },
          },
        },
      },
      '/api/v1/context/managed-credentials/{provider}/refresh': {
        post: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: options.managedCredentialRefreshSchema
                    ?? cloneJson(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA),
                },
              },
            },
          },
        },
      },
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

  it('exposes Context support API response schemas in the real checked-in OpenAPI specs', () => {
    const specs = [
      {
        label: 'JSON',
        openApi: JSON.parse(
          readFileSync(path.join(process.cwd(), 'docs/contracts/specs/openapi.json'), 'utf8'),
        ) as unknown,
      },
      {
        label: 'YAML',
        openApi: YAML.parse(
          readFileSync(path.join(process.cwd(), 'docs/contracts/specs/openapi.yaml'), 'utf8'),
        ) as unknown,
      },
    ];

    for (const spec of specs) {
      const contextSchema = readResponseJsonSchema({
        openApi: spec.openApi,
        path: '/api/v1/context',
        method: 'get',
      });
      const contextListSchema = readResponseJsonSchema({
        openApi: spec.openApi,
        path: '/api/v1/context/list',
        method: 'get',
      });
      const credentialRefreshSchema = readResponseJsonSchema({
        openApi: spec.openApi,
        path: '/api/v1/context/managed-credentials/{provider}/refresh',
        method: 'post',
      });

      expect(contextSchema, `${spec.label} /api/v1/context GET 200 schema`).toEqual(
        CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
      );
      const contextListProperties = readRecord(contextListSchema, 'properties');
      const contextListItems = readRecord(contextListProperties, 'items');
      expect(
        contextListItems?.items,
        `${spec.label} /api/v1/context/list GET 200 items.items`,
      ).toEqual(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA);
      expect(
        credentialRefreshSchema,
        `${spec.label} /api/v1/context/managed-credentials/{provider}/refresh POST 200 schema`,
      ).toEqual(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA);

      expectNoForbiddenSupportProjectionFields(contextSchema);
      expectNoForbiddenSupportProjectionFields(contextListSchema);
      expectNoForbiddenSupportProjectionFields(credentialRefreshSchema);
    }
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

  it('rejects missing Context support API response schemas', () => {
    const openApi = createOpenApiFixture();
    const paths = openApi.paths as Record<string, unknown>;
    delete paths['/api/v1/context'];
    delete paths['/api/v1/context/list'];
    delete paths['/api/v1/context/managed-credentials/{provider}/refresh'];

    const result = checkRunnerSupportApiProjections(openApi);

    expect(result.errors).toEqual([
      {
        code: 'missing_context_schema',
        path: 'paths./api/v1/context.get.responses.200.content.application/json.schema',
        message: 'OpenAPI must expose the Context Store entry response schema.',
      },
      {
        code: 'missing_context_list_schema',
        path: 'paths./api/v1/context/list.get.responses.200.content.application/json.schema.properties.items.items',
        message: 'OpenAPI must expose the Context Store list item response schema.',
      },
      {
        code: 'missing_managed_credential_refresh_schema',
        path: 'paths./api/v1/context/managed-credentials/{provider}/refresh.post.responses.200.content.application/json.schema',
        message: 'OpenAPI must expose the managed credential refresh response schema.',
      },
    ]);
  });

  it('rejects Context support API schema drift from the contract schema', () => {
    const contextSchema = cloneJson(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA) as Record<string, unknown>;
    const properties = contextSchema.properties as Record<string, Record<string, unknown>>;
    properties.scope.enum = ['member'];

    const result = checkRunnerSupportApiProjections(createOpenApiFixture({
      contextSchema,
    }));

    expect(result.errors).toEqual([
      {
        code: 'context_schema_mismatch',
        path: 'paths./api/v1/context.get.responses.200.content.application/json.schema.properties.scope.enum',
        message: 'Context Store entry response schema differs from runner support projection contract at properties.scope.enum: expected undefined, got ["member"]',
      },
    ]);
  });

  it('rejects descriptions added to Context support API response schemas', () => {
    const contextSchema = cloneJson(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA) as Record<string, unknown>;
    const properties = contextSchema.properties as Record<string, Record<string, unknown>>;
    properties.scope.description = 'legacy user scope should not be documented here';

    const result = checkRunnerSupportApiProjections(createOpenApiFixture({
      contextSchema,
    }));

    expect(result.errors).toEqual([
      {
        code: 'context_schema_mismatch',
        path: 'paths./api/v1/context.get.responses.200.content.application/json.schema.properties.scope.description',
        message: 'Context Store entry response schema differs from runner support projection contract at properties.scope.description: expected undefined, got "legacy user scope should not be documented here"',
      },
    ]);
  });

  it('rejects retired user scope on Context success query parameter enums', () => {
    const openApi = createOpenApiFixture();
    readGetScopeQueryParameterSchema(openApi, '/api/v1/context').enum = [
      ...CONTEXT_SCOPE_QUERY_ENUM,
      'user',
    ];
    readGetScopeQueryParameterSchema(openApi, '/api/v1/context/list').enum = [
      ...CONTEXT_SCOPE_QUERY_ENUM,
      'user',
    ];

    const result = checkRunnerSupportApiProjections(openApi);

    expect(result.errors).toEqual([
      {
        code: 'context_scope_parameter_mismatch',
        path: 'paths./api/v1/context.get.parameters.scope.schema.enum',
        message: '/api/v1/context GET scope query parameter enum must not include retired user scope.',
      },
      {
        code: 'context_scope_parameter_mismatch',
        path: 'paths./api/v1/context/list.get.parameters.scope.schema.enum',
        message: '/api/v1/context/list GET scope query parameter enum must not include retired user scope.',
      },
    ]);
  });

  it('rejects forbidden fields inside Context list item schemas', () => {
    const contextListItemSchema = cloneJson(CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA) as Record<string, unknown>;
    const properties = contextListItemSchema.properties as Record<string, unknown>;
    properties.credential_files = { type: 'array' };

    const result = checkRunnerSupportApiProjections(createOpenApiFixture({
      contextListItemSchema,
    }));

    expect(result.errors).toEqual([
      {
        code: 'support_projection_forbidden_product_semantics',
        path: 'paths./api/v1/context/list.get.responses.200.content.application/json.schema.properties.items.items.properties',
        message: 'Context Store list item schema contains fields forbidden from runner package support API projection contract: credential_files',
      },
    ]);
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
