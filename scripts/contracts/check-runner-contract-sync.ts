import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUNNER_CONTRACT_TERMINAL_FIXTURES,
  TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS,
  TASK_EXECUTION_CONTEXT_JSON_SCHEMA,
  TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS,
} from '@mbos/agent-runner-contract';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DEFAULT_ASYNCAPI_PATH = 'docs/contracts/specs/asyncapi.json';
const SERVER_REQUEST_START_MESSAGE_TYPE = 'server.request.start';

export type RunnerContractSyncErrorCode =
  | 'invalid_asyncapi'
  | 'missing_message'
  | 'missing_execution_context_schema'
  | 'execution_context_not_required'
  | 'execution_context_allows_additional_properties'
  | 'execution_context_extra_fields'
  | 'execution_context_missing_required_fields'
  | 'execution_context_schema_mismatch'
  | 'terminal_payload_required_keys_mismatch'
  | 'terminal_recovery_required_keys_mismatch'
  | 'missing_terminal_recovery_schema';

export type RunnerContractSyncError = {
  code: RunnerContractSyncErrorCode;
  message: string;
  path: string;
};

export type RunnerContractSyncResult = {
  errors: RunnerContractSyncError[];
};

type ExecutionContextSchemaHit = {
  messageType: string;
  path: string;
  schema: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const child = value[key];
  return isRecord(child) ? child : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function sortedStringArray(value: Iterable<string>): string[] {
  return [...value].sort((a, b) => a.localeCompare(b));
}

function formatValueForError(value: unknown): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

function schemaComparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => schemaComparable(item));
  }
  if (!isRecord(value)) return value;
  const entries = Object.entries(value)
    .filter(([key]) => key !== 'description')
    .map(([key, child]) => [key, schemaComparable(child)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

type SchemaMismatch = {
  path: string;
  expected: unknown;
  actual: unknown;
};

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

function readConstTypeFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const properties = readRecord(payload, 'properties');
  const typeSchema = properties ? readRecord(properties, 'type') : null;
  const typeConst = typeSchema?.const;
  return typeof typeConst === 'string' ? typeConst : null;
}

function readMessageType(message: Record<string, unknown>): string | null {
  const payloadType = readConstTypeFromPayload(readRecord(message, 'payload'));
  if (payloadType) return payloadType;
  const name = message.name;
  return typeof name === 'string' ? name : null;
}

function readMessages(asyncApi: unknown): Record<string, unknown> | null {
  if (!isRecord(asyncApi)) return null;
  const components = readRecord(asyncApi, 'components');
  if (!components) return null;
  return readRecord(components, 'messages');
}

function findMessageByType(
  messages: Record<string, unknown>,
  messageType: string,
): { key: string; message: Record<string, unknown> } | null {
  for (const [key, value] of Object.entries(messages)) {
    if (!isRecord(value)) continue;
    if (readMessageType(value) === messageType) {
      return { key, message: value };
    }
  }
  return null;
}

function collectExecutionContextSchemasFromSchema(
  schema: Record<string, unknown>,
  pathToSchema: string,
  messageType: string,
  hits: ExecutionContextSchemaHit[],
  componentSchemas: Record<string, unknown> | null,
): void {
  const properties = readRecord(schema, 'properties');
  if (!properties) return;
  const executionContext = readRecord(properties, 'execution_context');
  if (executionContext) {
    const resolvedExecutionContext = resolveLocalSchemaRef(
      executionContext,
      componentSchemas,
    ) ?? executionContext;
    hits.push({
      messageType,
      path: `${pathToSchema}.properties.execution_context`,
      schema: resolvedExecutionContext,
    });
  }
  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    if (!isRecord(propertySchema)) continue;
    collectExecutionContextSchemasFromSchema(
      propertySchema,
      `${pathToSchema}.properties.${propertyName}`,
      messageType,
      hits,
      componentSchemas,
    );
  }
}

function collectExecutionContextSchemas(
  messages: Record<string, unknown>,
  componentSchemas: Record<string, unknown> | null,
): ExecutionContextSchemaHit[] {
  const hits: ExecutionContextSchemaHit[] = [];
  for (const [messageKey, value] of Object.entries(messages)) {
    if (!isRecord(value)) continue;
    const payload = readRecord(value, 'payload');
    if (!payload) continue;
    collectExecutionContextSchemasFromSchema(
      payload,
      `components.messages.${messageKey}.payload`,
      readMessageType(value) ?? messageKey,
      hits,
      componentSchemas,
    );
  }
  return hits;
}

function validateExecutionContextSchema(
  hit: ExecutionContextSchemaHit,
  errors: RunnerContractSyncError[],
): void {
  const initialErrorCount = errors.length;
  if (hit.schema.additionalProperties !== false) {
    errors.push({
      code: 'execution_context_allows_additional_properties',
      message: `${hit.messageType} payload.execution_context must set additionalProperties: false`,
      path: `${hit.path}.additionalProperties`,
    });
  }

  const schemaProperties = readRecord(hit.schema, 'properties') ?? {};
  const allowedFields = new Set<string>(TASK_EXECUTION_CONTEXT_ALLOWED_FIELDS);
  const extraFields = Object.keys(schemaProperties)
    .filter((field) => !allowedFields.has(field))
    .sort();
  if (extraFields.length > 0) {
    errors.push({
      code: 'execution_context_extra_fields',
      message: `${hit.messageType} payload.execution_context has fields not in runner contract: ${extraFields.join(', ')}`,
      path: hit.path,
    });
  }

  const requiredFields = new Set(readStringArray(hit.schema.required));
  const missingRequiredFields = TASK_EXECUTION_CONTEXT_REQUIRED_FIELDS
    .filter((field) => !requiredFields.has(field))
    .sort();
  if (missingRequiredFields.length > 0) {
    errors.push({
      code: 'execution_context_missing_required_fields',
      message: `${hit.messageType} payload.execution_context is missing required runner contract fields: ${missingRequiredFields.join(', ')}`,
      path: `${hit.path}.required`,
    });
  }

  if (errors.length > initialErrorCount) return;

  const mismatch = findSchemaMismatch(
    schemaComparable(TASK_EXECUTION_CONTEXT_JSON_SCHEMA),
    schemaComparable(hit.schema),
  );
  if (mismatch) {
    errors.push({
      code: 'execution_context_schema_mismatch',
      message: `${hit.messageType} payload.execution_context schema differs from runner contract at ${mismatch.path}: expected ${formatValueForError(mismatch.expected)}, got ${formatValueForError(mismatch.actual)}`,
      path: `${hit.path}.${mismatch.path}`,
    });
  }
}

function readComponentSchemas(asyncApi: unknown): Record<string, unknown> | null {
  if (!isRecord(asyncApi)) return null;
  const components = readRecord(asyncApi, 'components');
  if (!components) return null;
  return readRecord(components, 'schemas');
}

function resolveLocalSchemaRef(
  schema: Record<string, unknown>,
  componentSchemas: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const ref = schema.$ref;
  if (typeof ref !== 'string') return schema;
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix) || !componentSchemas) return null;
  const resolved = componentSchemas[ref.slice(prefix.length)];
  return isRecord(resolved) ? resolved : null;
}

function readAgentReadyActiveTerminalItemsSchema(
  asyncApi: unknown,
  messages: Record<string, unknown>,
): { itemSchema: Record<string, unknown>; path: string } | null {
  const agentReady = findMessageByType(messages, 'agent.ready');
  if (!agentReady) return null;
  const payload = readRecord(agentReady.message, 'payload');
  const properties = payload ? readRecord(payload, 'properties') : null;
  const framePayload = properties ? readRecord(properties, 'payload') : null;
  const framePayloadProperties = framePayload ? readRecord(framePayload, 'properties') : null;
  const activeTerminals = framePayloadProperties
    ? readRecord(framePayloadProperties, 'active_terminals')
    : null;
  if (!activeTerminals) return null;
  const rawItems = readRecord(activeTerminals, 'items');
  const items = rawItems
    ? resolveLocalSchemaRef(rawItems, readComponentSchemas(asyncApi))
    : null;
  if (!items) return null;
  return {
    itemSchema: items,
    path: `components.messages.${agentReady.key}.payload.properties.payload.properties.active_terminals.items`,
  };
}

function hasAgentReadyActiveTerminalRecoverySchema(
  asyncApi: unknown,
  messages: Record<string, unknown>,
): boolean {
  const activeTerminalItems = readAgentReadyActiveTerminalItemsSchema(asyncApi, messages);
  if (!activeTerminalItems) return false;
  const items = activeTerminalItems.itemSchema;
  const itemProperties = items ? readRecord(items, 'properties') : null;
  if (!itemProperties) return false;
  const fixture = RUNNER_CONTRACT_TERMINAL_FIXTURES.terminalRecoveryReady.payload
    .active_terminals[0];
  return Object.keys(fixture).every((field) => Object.hasOwn(itemProperties, field));
}

function readFramePayloadSchemaForMessage(
  messages: Record<string, unknown>,
  messageType: string,
): { key: string; schema: Record<string, unknown>; path: string } | null {
  const found = findMessageByType(messages, messageType);
  if (!found) return null;
  const payload = readRecord(found.message, 'payload');
  const properties = payload ? readRecord(payload, 'properties') : null;
  const framePayload = properties ? readRecord(properties, 'payload') : null;
  if (!framePayload) return null;
  return {
    key: found.key,
    schema: framePayload,
    path: `components.messages.${found.key}.payload.properties.payload`,
  };
}

function validateServerRequestStartExecutionContext(
  messages: Record<string, unknown>,
  errors: RunnerContractSyncError[],
): void {
  const serverRequestStart = findMessageByType(messages, SERVER_REQUEST_START_MESSAGE_TYPE);
  if (!serverRequestStart) return;
  const framePayload = readFramePayloadSchemaForMessage(
    messages,
    SERVER_REQUEST_START_MESSAGE_TYPE,
  );
  if (!framePayload) {
    errors.push({
      code: 'missing_execution_context_schema',
      message: 'server.request.start payload must expose execution_context',
      path: `components.messages.${serverRequestStart.key}.payload.properties.payload`,
    });
    return;
  }

  const properties = readRecord(framePayload.schema, 'properties');
  const executionContext = properties ? readRecord(properties, 'execution_context') : null;
  if (!executionContext) {
    errors.push({
      code: 'missing_execution_context_schema',
      message: 'server.request.start payload must expose execution_context',
      path: `${framePayload.path}.properties.execution_context`,
    });
    return;
  }

  if (!readStringArray(framePayload.schema.required).includes('execution_context')) {
    errors.push({
      code: 'execution_context_not_required',
      message: 'server.request.start payload.required must include execution_context',
      path: `${framePayload.path}.required`,
    });
  }
}

function validateTerminalPayloadRequiredKeys(
  messages: Record<string, unknown>,
  errors: RunnerContractSyncError[],
): void {
  const expectedByType = new Map<string, Record<string, unknown>>([
    [
      RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalStart.type,
      RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalStart.payload,
    ],
    [
      RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalAdopt.type,
      RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalAdopt.payload,
    ],
    [
      RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalClose.type,
      RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalClose.payload,
    ],
  ]);

  for (const [messageType, fixturePayload] of expectedByType) {
    const framePayload = readFramePayloadSchemaForMessage(messages, messageType);
    if (!framePayload) continue;
    const expected = sortedStringArray(Object.keys(fixturePayload));
    const actual = sortedStringArray(readStringArray(framePayload.schema.required));
    if (expected.join('\u0000') !== actual.join('\u0000')) {
      errors.push({
        code: 'terminal_payload_required_keys_mismatch',
        message: `${messageType} payload required keys differ from runner fixture: expected ${expected.join(', ')}, got ${actual.join(', ')}`,
        path: `${framePayload.path}.required`,
      });
    }
  }
}

function validateTerminalRecoveryRequiredKeys(
  asyncApi: unknown,
  messages: Record<string, unknown>,
  errors: RunnerContractSyncError[],
): void {
  const activeTerminalItems = readAgentReadyActiveTerminalItemsSchema(asyncApi, messages);
  if (!activeTerminalItems) return;
  const fixture = RUNNER_CONTRACT_TERMINAL_FIXTURES.terminalRecoveryReady.payload
    .active_terminals[0];
  const expected = sortedStringArray(
    Object.keys(fixture).filter((key) => key !== 'cwd'),
  );
  const actual = sortedStringArray(readStringArray(activeTerminalItems.itemSchema.required));
  if (expected.join('\u0000') !== actual.join('\u0000')) {
    errors.push({
      code: 'terminal_recovery_required_keys_mismatch',
      message: `agent.ready active terminal required keys differ from runner fixture: expected ${expected.join(', ')}, got ${actual.join(', ')}`,
      path: `${activeTerminalItems.path}.required`,
    });
  }
}

export function checkRunnerContractSync(asyncApi: unknown): RunnerContractSyncResult {
  const errors: RunnerContractSyncError[] = [];
  const messages = readMessages(asyncApi);
  if (!messages) {
    return {
      errors: [
        {
          code: 'invalid_asyncapi',
          message: 'AsyncAPI must expose components.messages',
          path: 'components.messages',
        },
      ],
    };
  }

  const requiredRunnerMessages = [
    SERVER_REQUEST_START_MESSAGE_TYPE,
    RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalStart.type,
    RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalAdopt.type,
    RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalClose.type,
  ];
  for (const messageType of requiredRunnerMessages) {
    if (!findMessageByType(messages, messageType)) {
      errors.push({
        code: 'missing_message',
        message: `AsyncAPI is missing required runner message: ${messageType}`,
        path: 'components.messages',
      });
    }
  }
  validateServerRequestStartExecutionContext(messages, errors);
  validateTerminalPayloadRequiredKeys(messages, errors);
  validateTerminalRecoveryRequiredKeys(asyncApi, messages, errors);

  const componentSchemas = readComponentSchemas(asyncApi);
  const executionContextHits = collectExecutionContextSchemas(messages, componentSchemas);
  for (const hit of executionContextHits) {
    validateExecutionContextSchema(hit, errors);
  }
  if (
    findMessageByType(messages, RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalStart.type)
    && !executionContextHits.some((hit) => hit.messageType === 'server.terminal.start')
  ) {
    errors.push({
      code: 'missing_execution_context_schema',
      message: 'server.terminal.start payload must expose execution_context',
      path: 'components.messages',
    });
  }

  if (!hasAgentReadyActiveTerminalRecoverySchema(asyncApi, messages)) {
    errors.push({
      code: 'missing_terminal_recovery_schema',
      message: 'AsyncAPI agent.ready payload must expose active_terminals for terminal recovery',
      path: 'components.messages',
    });
  }

  return { errors };
}

export function formatRunnerContractSyncErrors(
  errors: readonly RunnerContractSyncError[],
): string {
  if (errors.length === 0) return '[contracts] Runner contract sync check passed.';
  return [
    '[contracts] Runner contract sync drift detected.',
    ...errors.map((error) => `- ${error.code} ${error.path}: ${error.message}`),
  ].join('\n');
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
}

function runCli(): void {
  const asyncApiPath = path.resolve(REPO_ROOT, process.argv[2] ?? DEFAULT_ASYNCAPI_PATH);
  const result = checkRunnerContractSync(readJsonFile(asyncApiPath));
  const output = formatRunnerContractSyncErrors(result.errors);
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
