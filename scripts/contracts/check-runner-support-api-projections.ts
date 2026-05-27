import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DEFAULT_OPENAPI_PATHS = [
  'docs/contracts/specs/openapi.json',
  'docs/contracts/specs/openapi.yaml',
] as const;
const WORKSPACE_ACCESS_PATH =
  '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/workspace-access';
const WORKSPACE_ACCESS_RELEASE_PATH = `${WORKSPACE_ACCESS_PATH}/release`;

export type RunnerSupportApiProjectionErrorCode =
  | 'invalid_openapi'
  | 'missing_workspace_access_schema'
  | 'missing_workspace_access_release_schema'
  | 'workspace_access_schema_mismatch'
  | 'workspace_access_release_schema_mismatch'
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
    .filter(([key]) => {
      if (key === 'description') return false;
      return true;
    })
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

function readWorkspaceAccessResponseSchema(openApi: unknown): Record<string, unknown> | null {
  const paths = readOpenApiPaths(openApi);
  const route = readRecord(paths, WORKSPACE_ACCESS_PATH);
  const post = readRecord(route, 'post');
  const responses = readRecord(post, 'responses');
  const ok = readRecord(responses, '200');
  const content = readRecord(ok, 'content');
  const json = readRecord(content, 'application/json');
  return readRecord(json, 'schema');
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
  if (forbidden.length > 0) {
    input.errors.push({
      code: 'support_projection_forbidden_product_semantics',
      path: `${input.path}.properties`,
      message: `${input.schemaLabel} schema contains fields forbidden from runner package support API projection contract: ${forbidden.join(', ')}`,
    });
    return false;
  }

  const properties = readRecord(input.schema, 'properties') ?? {};
  let ok = true;
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    if (!isRecord(fieldSchema)) continue;
    ok = validateForbiddenSchemaProperties({
      schema: fieldSchema,
      schemaLabel: input.schemaLabel,
      path: `${input.path}.properties.${fieldName}`,
      errors: input.errors,
    }) && ok;
  }
  return ok;
}

function validateSchemaSync(input: {
  expected: unknown;
  actual: Record<string, unknown>;
  code: Extract<
    RunnerSupportApiProjectionErrorCode,
    'workspace_access_schema_mismatch' | 'workspace_access_release_schema_mismatch'
  >;
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
    MANAGED_CREDENTIAL_PROJECTION_JSON_SCHEMA,
    CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA,
    PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,
    PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,
    PROJECTED_DEPENDENCIES_ENV_FIXTURE,
  };
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

  const workspaceAccessSchemaPath =
    `paths.${WORKSPACE_ACCESS_PATH}.post.responses.200.content.application/json.schema`;
  const workspaceAccessSchema = readWorkspaceAccessResponseSchema(openApi);
  if (!workspaceAccessSchema) {
    errors.push({
      code: 'missing_workspace_access_schema',
      path: workspaceAccessSchemaPath,
      message: 'OpenAPI must expose the task workspace-access response schema.',
    });
  } else if (validateForbiddenSchemaProperties({
    schema: workspaceAccessSchema,
    schemaLabel: 'workspace-access response',
    path: workspaceAccessSchemaPath,
    errors,
  })) {
    validateSchemaSync({
      expected: TASK_WORKSPACE_ACCESS_JSON_SCHEMA,
      actual: workspaceAccessSchema,
      code: 'workspace_access_schema_mismatch',
      label: 'workspace-access response',
      path: workspaceAccessSchemaPath,
      errors,
    });
  }

  const releaseRequestSchemaPath =
    `paths.${WORKSPACE_ACCESS_RELEASE_PATH}.post.requestBody.content.application/json.schema`;
  const releaseRequestSchema = readWorkspaceAccessReleaseRequestSchema(openApi);
  if (!releaseRequestSchema) {
    errors.push({
      code: 'missing_workspace_access_release_schema',
      path: releaseRequestSchemaPath,
      message: 'OpenAPI must expose the task workspace-access release request schema.',
    });
  } else if (validateForbiddenSchemaProperties({
    schema: releaseRequestSchema,
    schemaLabel: 'workspace-access release request',
    path: releaseRequestSchemaPath,
    errors,
  })) {
    validateSchemaSync({
      expected: TASK_WORKSPACE_ACCESS_RELEASE_REQUEST_SCHEMA,
      actual: releaseRequestSchema,
      code: 'workspace_access_release_schema_mismatch',
      label: 'workspace-access release request',
      path: releaseRequestSchemaPath,
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
