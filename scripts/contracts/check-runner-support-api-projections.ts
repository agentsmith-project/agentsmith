import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
  PROJECTED_DEPENDENCIES_ENV_FIXTURE,
  PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,
  PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,
  RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS,
  TASK_WORKSPACE_ACCESS_FIXTURE,
  TASK_WORKSPACE_ACCESS_JSON_SCHEMA,
  TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_FIXTURE,
  TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
} from '@mbos/agent-runner-contract';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DEFAULT_OPENAPI_PATHS = [
  'docs/contracts/specs/openapi.json',
  'docs/contracts/specs/openapi.yaml',
] as const;
const WORKSPACE_ACCESS_PATH =
  '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/workspace-access';
const WORKSPACE_ACCESS_RELEASE_PATH = `${WORKSPACE_ACCESS_PATH}/release`;
const CONTEXT_PATH = '/api/v1/context';
const CONTEXT_LIST_PATH = '/api/v1/context/list';
const RETIRED_CONTEXT_SCOPE = 'user';

export type RunnerSupportApiProjectionErrorCode =
  | 'invalid_openapi'
  | 'missing_workspace_access_schema'
  | 'missing_workspace_access_release_schema'
  | 'missing_context_schema'
  | 'missing_context_list_schema'
  | 'context_scope_parameter_mismatch'
  | 'workspace_access_schema_mismatch'
  | 'workspace_access_release_schema_mismatch'
  | 'context_schema_mismatch'
  | 'context_list_schema_mismatch'
  | 'support_projection_forbidden_product_semantics';

export type RunnerSupportApiProjectionError = {
  code: RunnerSupportApiProjectionErrorCode;
  path: string;
  message: string;
};

export type RunnerSupportApiProjectionResult = {
  errors: RunnerSupportApiProjectionError[];
};

type SchemaMismatch = {
  path: string;
  expected: unknown;
  actual: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!value) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function sortedStringArray(value: Iterable<string>): string[] {
  return [...value].sort((a, b) => a.localeCompare(b));
}

function formatValueForError(value: unknown): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

function schemaComparable(value: unknown, peer?: unknown): unknown {
  if (Array.isArray(value)) {
    const peerArray = Array.isArray(peer) ? peer : [];
    return value.map((item, index) => schemaComparable(item, peerArray[index]));
  }
  if (!isRecord(value)) return value;
  const peerRecord = isRecord(peer) ? peer : {};
  const entries = Object.entries(value)
    .map(([key, child]) => [key, schemaComparable(child, peerRecord[key])] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

function findSchemaMismatch(
  expected: unknown,
  actual: unknown,
  pathParts: string[] = [],
): SchemaMismatch | null {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return {
        path: pathParts.join('.'),
        expected,
        actual,
      };
    }
    if (expected.length !== actual.length) {
      return {
        path: [...pathParts, 'length'].join('.'),
        expected: expected.length,
        actual: actual.length,
      };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = findSchemaMismatch(expected[index], actual[index], [
        ...pathParts,
        String(index),
      ]);
      if (mismatch) return mismatch;
    }
    return null;
  }

  if (isRecord(expected) || isRecord(actual)) {
    if (!isRecord(expected) || !isRecord(actual)) {
      return {
        path: pathParts.join('.'),
        expected,
        actual,
      };
    }
    const expectedKeys = sortedStringArray(Object.keys(expected));
    const actualKeys = sortedStringArray(Object.keys(actual));
    const allKeys = sortedStringArray(new Set([...expectedKeys, ...actualKeys]));
    for (const key of allKeys) {
      if (!Object.hasOwn(expected, key)) {
        return {
          path: [...pathParts, key].join('.'),
          expected: undefined,
          actual: actual[key],
        };
      }
      if (!Object.hasOwn(actual, key)) {
        return {
          path: [...pathParts, key].join('.'),
          expected: expected[key],
          actual: undefined,
        };
      }
      const mismatch = findSchemaMismatch(expected[key], actual[key], [...pathParts, key]);
      if (mismatch) return mismatch;
    }
    return null;
  }

  if (expected !== actual) {
    return {
      path: pathParts.join('.'),
      expected,
      actual,
    };
  }
  return null;
}

function readOpenApiPaths(openApi: unknown): Record<string, unknown> | null {
  if (!isRecord(openApi)) return null;
  return readRecord(openApi, 'paths');
}

function readOperation(openApi: unknown, apiPath: string, method: string): Record<string, unknown> | null {
  const paths = readOpenApiPaths(openApi);
  const route = readRecord(paths, apiPath);
  return readRecord(route, method);
}

function readResponseJsonSchema(input: {
  openApi: unknown;
  apiPath: string;
  method: string;
}): Record<string, unknown> | null {
  const operation = readOperation(input.openApi, input.apiPath, input.method);
  const responses = readRecord(operation, 'responses');
  const ok = readRecord(responses, '200');
  const content = readRecord(ok, 'content');
  const json = readRecord(content, 'application/json');
  return readRecord(json, 'schema');
}

function readQueryParameterSchema(input: {
  openApi: unknown;
  apiPath: string;
  method: string;
  name: string;
}): Record<string, unknown> | null {
  const operation = readOperation(input.openApi, input.apiPath, input.method);
  const parameters = operation?.parameters;
  if (!Array.isArray(parameters)) return null;
  const parameter = parameters.find((candidate) => (
    isRecord(candidate)
    && candidate.name === input.name
    && candidate.in === 'query'
  ));
  return isRecord(parameter) ? readRecord(parameter, 'schema') : null;
}

function readWorkspaceAccessResponseSchema(openApi: unknown): Record<string, unknown> | null {
  return readResponseJsonSchema({
    openApi,
    apiPath: WORKSPACE_ACCESS_PATH,
    method: 'post',
  });
}

function readWorkspaceAccessReleaseRequestSchema(openApi: unknown): Record<string, unknown> | null {
  const paths = readOpenApiPaths(openApi);
  const route = readRecord(paths, WORKSPACE_ACCESS_RELEASE_PATH);
  const post = readRecord(route, 'post');
  const requestBody = readRecord(post, 'requestBody');
  const content = readRecord(requestBody, 'content');
  const json = readRecord(content, 'application/json');
  return readRecord(json, 'schema');
}

function readContextResponseSchema(openApi: unknown): Record<string, unknown> | null {
  return readResponseJsonSchema({
    openApi,
    apiPath: CONTEXT_PATH,
    method: 'get',
  });
}

function readContextListResponseSchema(openApi: unknown): Record<string, unknown> | null {
  return readResponseJsonSchema({
    openApi,
    apiPath: CONTEXT_LIST_PATH,
    method: 'get',
  });
}

function readContextListItemSchema(openApi: unknown): Record<string, unknown> | null {
  const schema = readContextListResponseSchema(openApi);
  const properties = readRecord(schema, 'properties');
  const items = readRecord(properties, 'items');
  return readRecord(items, 'items');
}

function findForbiddenSchemaPropertyNames(schema: Record<string, unknown>): string[] {
  const properties = readRecord(schema, 'properties') ?? {};
  return Object.keys(properties)
    .filter((key) => RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS.includes(
      key as (typeof RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS)[number],
    ))
    .sort((a, b) => a.localeCompare(b));
}

function validateForbiddenSchemaProperties(input: {
  schema: Record<string, unknown>;
  schemaLabel: string;
  path: string;
  errors: RunnerSupportApiProjectionError[];
}): boolean {
  const forbidden = findForbiddenSchemaPropertyNames(input.schema);
  let ok = true;
  if (forbidden.length > 0) {
    input.errors.push({
      code: 'support_projection_forbidden_product_semantics',
      path: `${input.path}.properties`,
      message: `${input.schemaLabel} schema contains fields forbidden from runner package support API projection contract: ${forbidden.join(', ')}`,
    });
    ok = false;
  }

  const properties = readRecord(input.schema, 'properties') ?? {};
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    if (!isRecord(fieldSchema)) continue;
    ok = validateForbiddenSchemaProperties({
      schema: fieldSchema,
      schemaLabel: input.schemaLabel,
      path: `${input.path}.properties.${fieldName}`,
      errors: input.errors,
    }) && ok;
  }

  const items = readRecord(input.schema, 'items');
  if (items) {
    ok = validateForbiddenSchemaProperties({
      schema: items,
      schemaLabel: input.schemaLabel,
      path: `${input.path}.items`,
      errors: input.errors,
    }) && ok;
  }

  const additionalProperties = input.schema.additionalProperties;
  if (isRecord(additionalProperties)) {
    ok = validateForbiddenSchemaProperties({
      schema: additionalProperties,
      schemaLabel: input.schemaLabel,
      path: `${input.path}.additionalProperties`,
      errors: input.errors,
    }) && ok;
  }

  const oneOf = input.schema.oneOf;
  if (Array.isArray(oneOf)) {
    oneOf.forEach((schema, index) => {
      if (!isRecord(schema)) return;
      ok = validateForbiddenSchemaProperties({
        schema,
        schemaLabel: input.schemaLabel,
        path: `${input.path}.oneOf.${index}`,
        errors: input.errors,
      }) && ok;
    });
  }

  return ok;
}

type SchemaMismatchErrorCode = Extract<
  RunnerSupportApiProjectionErrorCode,
  | 'workspace_access_schema_mismatch'
  | 'workspace_access_release_schema_mismatch'
  | 'context_schema_mismatch'
  | 'context_list_schema_mismatch'
>;

function validateSchemaSync(input: {
  expected: unknown;
  actual: Record<string, unknown>;
  code: SchemaMismatchErrorCode;
  label: string;
  path: string;
  errors: RunnerSupportApiProjectionError[];
}): void {
  const mismatch = findSchemaMismatch(
    schemaComparable(input.expected, input.actual),
    schemaComparable(input.actual, input.expected),
  );
  if (!mismatch) return;
  input.errors.push({
    code: input.code,
    path: `${input.path}.${mismatch.path}`,
    message: `${input.label} schema differs from runner support projection contract at ${mismatch.path}: expected ${formatValueForError(mismatch.expected)}, got ${formatValueForError(mismatch.actual)}`,
  });
}

function scanForbiddenProductSemantics(input: {
  value: unknown;
  path: string;
  errors: RunnerSupportApiProjectionError[];
}): void {
  const rejected = new Set<string>(RUNNER_SUPPORT_API_PROJECTION_REJECTED_PRODUCT_SEMANTICS);
  if (typeof input.value === 'string') {
    if (rejected.has(input.value)) {
      input.errors.push({
        code: 'support_projection_forbidden_product_semantics',
        path: input.path,
        message: `runner support projection artifact must not expose product semantics: ${input.value}`,
      });
    }
    return;
  }
  if (Array.isArray(input.value)) {
    input.value.forEach((item, index) => {
      scanForbiddenProductSemantics({
        value: item,
        path: `${input.path}.${index}`,
        errors: input.errors,
      });
    });
    return;
  }
  if (!isRecord(input.value)) return;
  for (const [key, child] of Object.entries(input.value)) {
    const childPath = input.path ? `${input.path}.${key}` : key;
    if (rejected.has(key)) {
      input.errors.push({
        code: 'support_projection_forbidden_product_semantics',
        path: childPath,
        message: `runner support projection artifact must not expose product semantics: ${key}`,
      });
      continue;
    }
    scanForbiddenProductSemantics({
      value: child,
      path: childPath,
      errors: input.errors,
    });
  }
}

export function checkRunnerSupportApiProjectionArtifact(
  artifact: unknown,
): RunnerSupportApiProjectionResult {
  const errors: RunnerSupportApiProjectionError[] = [];
  scanForbiddenProductSemantics({ value: artifact, path: '', errors });
  return { errors };
}

function defaultSupportProjectionArtifact(): Record<string, unknown> {
  return {
    TASK_WORKSPACE_ACCESS_JSON_SCHEMA,
    TASK_WORKSPACE_ACCESS_FIXTURE,
    TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
    TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_FIXTURE,
    CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
    PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,
    PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,
    PROJECTED_DEPENDENCIES_ENV_FIXTURE,
  };
}

type MissingSchemaErrorCode = Extract<
  RunnerSupportApiProjectionErrorCode,
  | 'missing_workspace_access_schema'
  | 'missing_workspace_access_release_schema'
  | 'missing_context_schema'
  | 'missing_context_list_schema'
>;

function validateSupportProjectionSchema(input: {
  actual: Record<string, unknown> | null;
  expected: unknown;
  missingCode: MissingSchemaErrorCode;
  mismatchCode: SchemaMismatchErrorCode;
  label: string;
  path: string;
  missingMessage: string;
  errors: RunnerSupportApiProjectionError[];
}): void {
  if (!input.actual) {
    input.errors.push({
      code: input.missingCode,
      path: input.path,
      message: input.missingMessage,
    });
    return;
  }

  if (!validateForbiddenSchemaProperties({
    schema: input.actual,
    schemaLabel: input.label,
    path: input.path,
    errors: input.errors,
  })) {
    return;
  }

  validateSchemaSync({
    expected: input.expected,
    actual: input.actual,
    code: input.mismatchCode,
    label: input.label,
    path: input.path,
    errors: input.errors,
  });
}

function validateContextScopeQueryParameter(input: {
  openApi: unknown;
  apiPath: typeof CONTEXT_PATH | typeof CONTEXT_LIST_PATH;
  errors: RunnerSupportApiProjectionError[];
}): void {
  const operation = readOperation(input.openApi, input.apiPath, 'get');
  if (!operation) return;

  const enumPath = `paths.${input.apiPath}.get.parameters.scope.schema.enum`;
  const schema = readQueryParameterSchema({
    openApi: input.openApi,
    apiPath: input.apiPath,
    method: 'get',
    name: 'scope',
  });
  const scopeEnum = schema?.enum;
  if (!Array.isArray(scopeEnum)) {
    input.errors.push({
      code: 'context_scope_parameter_mismatch',
      path: enumPath,
      message: `${input.apiPath} GET scope query parameter must expose a closed enum.`,
    });
    return;
  }
  if (scopeEnum.includes(RETIRED_CONTEXT_SCOPE)) {
    input.errors.push({
      code: 'context_scope_parameter_mismatch',
      path: enumPath,
      message: `${input.apiPath} GET scope query parameter enum must not include retired user scope.`,
    });
  }
}

export function checkRunnerSupportApiProjections(openApi: unknown): RunnerSupportApiProjectionResult {
  const errors: RunnerSupportApiProjectionError[] = [
    ...checkRunnerSupportApiProjectionArtifact(defaultSupportProjectionArtifact()).errors,
  ];
  const paths = readOpenApiPaths(openApi);
  if (!paths) {
    errors.push({
      code: 'invalid_openapi',
      path: 'paths',
      message: 'OpenAPI must expose paths.',
    });
    return { errors };
  }

  validateContextScopeQueryParameter({
    openApi,
    apiPath: CONTEXT_PATH,
    errors,
  });
  validateContextScopeQueryParameter({
    openApi,
    apiPath: CONTEXT_LIST_PATH,
    errors,
  });

  const workspaceAccessSchemaPath =
    `paths.${WORKSPACE_ACCESS_PATH}.post.responses.200.content.application/json.schema`;
  validateSupportProjectionSchema({
    actual: readWorkspaceAccessResponseSchema(openApi),
    expected: TASK_WORKSPACE_ACCESS_JSON_SCHEMA,
    missingCode: 'missing_workspace_access_schema',
    mismatchCode: 'workspace_access_schema_mismatch',
    label: 'workspace-access response',
    path: workspaceAccessSchemaPath,
    missingMessage: 'OpenAPI must expose the task workspace-access response schema.',
    errors,
  });

  const releaseRequestSchemaPath =
    `paths.${WORKSPACE_ACCESS_RELEASE_PATH}.post.requestBody.content.application/json.schema`;
  validateSupportProjectionSchema({
    actual: readWorkspaceAccessReleaseRequestSchema(openApi),
    expected: TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
    missingCode: 'missing_workspace_access_release_schema',
    mismatchCode: 'workspace_access_release_schema_mismatch',
    label: 'workspace-access release request',
    path: releaseRequestSchemaPath,
    missingMessage: 'OpenAPI must expose the task workspace-access release request schema.',
    errors,
  });

  const contextSchemaPath =
    `paths.${CONTEXT_PATH}.get.responses.200.content.application/json.schema`;
  validateSupportProjectionSchema({
    actual: readContextResponseSchema(openApi),
    expected: CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
    missingCode: 'missing_context_schema',
    mismatchCode: 'context_schema_mismatch',
    label: 'Context Store entry response',
    path: contextSchemaPath,
    missingMessage: 'OpenAPI must expose the Context Store entry response schema.',
    errors,
  });

  const contextListResponseSchemaPath =
    `paths.${CONTEXT_LIST_PATH}.get.responses.200.content.application/json.schema`;
  const contextListItemSchemaPath = `${contextListResponseSchemaPath}.properties.items.items`;
  const contextListResponseSchema = readContextListResponseSchema(openApi);
  if (!contextListResponseSchema) {
    errors.push({
      code: 'missing_context_list_schema',
      path: contextListItemSchemaPath,
      message: 'OpenAPI must expose the Context Store list item response schema.',
    });
  } else if (validateForbiddenSchemaProperties({
    schema: contextListResponseSchema,
    schemaLabel: 'Context Store list item',
    path: contextListResponseSchemaPath,
    errors,
  })) {
    validateSupportProjectionSchema({
      actual: readContextListItemSchema(openApi),
      expected: CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
      missingCode: 'missing_context_list_schema',
      mismatchCode: 'context_list_schema_mismatch',
      label: 'Context Store list item',
      path: contextListItemSchemaPath,
      missingMessage: 'OpenAPI must expose the Context Store list item response schema.',
      errors,
    });
  }

  return { errors };
}

export function formatRunnerSupportApiProjectionErrors(
  errors: readonly RunnerSupportApiProjectionError[],
): string {
  if (errors.length === 0) {
    return '[contracts] Runner support API projection check passed.';
  }
  return [
    '[contracts] Runner support API projection drift detected.',
    ...errors.map((error) => `- ${error.code} ${error.path}: ${error.message}`),
  ].join('\n');
}

function readOpenApiFile(filePath: string): unknown {
  const source = readFileSync(filePath, 'utf8');
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.yaml' || extension === '.yml') {
    return YAML.parse(source) as unknown;
  }
  return JSON.parse(source) as unknown;
}

export function checkRunnerSupportApiProjectionFiles(
  openApiPaths: readonly string[] = DEFAULT_OPENAPI_PATHS,
): RunnerSupportApiProjectionResult {
  const errors: RunnerSupportApiProjectionError[] = [];
  for (const openApiPath of openApiPaths) {
    const resolvedPath = path.resolve(REPO_ROOT, openApiPath);
    const label = path.relative(REPO_ROOT, resolvedPath);
    try {
      const result = checkRunnerSupportApiProjections(readOpenApiFile(resolvedPath));
      errors.push(...result.errors.map((error) => ({
        ...error,
        path: `${label}:${error.path}`,
        message: `${label}: ${error.message}`,
      })));
    } catch (error) {
      errors.push({
        code: 'invalid_openapi',
        path: label,
        message: `${label}: OpenAPI must parse as JSON or YAML: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { errors };
}

function runCli(): void {
  const openApiPaths = process.argv.length > 2
    ? process.argv.slice(2)
    : DEFAULT_OPENAPI_PATHS;
  const result = checkRunnerSupportApiProjectionFiles(openApiPaths);
  const output = formatRunnerSupportApiProjectionErrors(result.errors);
  if (result.errors.length > 0) {
    process.stderr.write(`${output}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${output}\n`);
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === currentModulePath) {
  runCli();
}
