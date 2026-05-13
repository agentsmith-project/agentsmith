import { normalizeAfscpValidatedValue } from './afscp-validation.js';

export type AfscpPublicErrorCode =
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'afscp_resource_not_found'
  | 'afscp_restore_preview_stale'
  | 'afscp_active_writer_blocks_restore'
  | 'afscp_repo_mutation_in_progress'
  | 'afscp_template_clone_not_allowed'
  | 'afscp_capability_denied'
  | 'afscp_service_permission_denied'
  | 'afscp_volume_mismatch_requires_admin'
  | 'afscp_operator_recovery_required'
  | 'afscp_service_configuration_error'
  | 'afscp_error';

export type AfscpResourceKind =
  | 'volume'
  | 'namespace'
  | 'repo'
  | 'repo_template'
  | 'save_point'
  | 'restore_plan'
  | 'export'
  | 'workload_mount_binding'
  | 'operation';

export interface AfscpMappedError {
  status: number;
  code: AfscpPublicErrorCode;
  message: AfscpPublicErrorCode;
  retryable: boolean;
  correlation_id?: string;
  operation_id?: string;
  resource_kind?: AfscpResourceKind;
}

const NOT_FOUND_ERROR_CODES = new Set([
  'NAMESPACE_NOT_FOUND',
  'REPO_NOT_FOUND',
  'REPO_TEMPLATE_NOT_FOUND',
  'SAVE_POINT_NOT_FOUND',
  'RESTORE_PLAN_NOT_FOUND',
  'EXPORT_NOT_FOUND',
  'WORKLOAD_MOUNT_BINDING_NOT_FOUND',
  'VOLUME_NOT_FOUND',
  'OPERATION_NOT_FOUND',
]);

const RESOURCE_KINDS = new Set<AfscpResourceKind>([
  'volume',
  'namespace',
  'repo',
  'repo_template',
  'save_point',
  'restore_plan',
  'export',
  'workload_mount_binding',
  'operation',
]);

export function sanitizeAfscpCorrelationId(value: string | null | undefined): string | undefined {
  return normalizeAfscpValidatedValue('correlation_id', value);
}

export function sanitizeAfscpOperationId(value: string | null | undefined): string | undefined {
  return normalizeAfscpValidatedValue('operation_id', value);
}

export class AfscpClientError extends Error {
  readonly status: number;
  readonly code: AfscpPublicErrorCode;
  readonly retryable: boolean;
  readonly correlation_id?: string;
  readonly operation_id?: string;
  readonly resource_kind?: AfscpResourceKind;

  constructor(input: AfscpMappedError) {
    super(`afscp_request_failed:${input.code}`);
    this.name = 'AfscpClientError';
    this.status = input.status;
    this.code = input.code;
    this.retryable = input.retryable;
    this.correlation_id = input.correlation_id;
    this.operation_id = input.operation_id;
    this.resource_kind = input.resource_kind;
  }

  toJSON(): AfscpMappedError {
    return buildMappedError({
      status: this.status,
      code: this.code,
      retryable: this.retryable,
      correlation_id: this.correlation_id,
      operation_id: this.operation_id,
      resource_kind: this.resource_kind,
    });
  }
}

interface ParsedAfscpError {
  code?: string;
  message?: string;
  retryable?: boolean;
  correlation_id?: string;
  operation_id?: string;
  resource_kind?: AfscpResourceKind;
  validation_errors: string[];
  writer_gate_error_family?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function extractResourceKind(error: Record<string, unknown>): AfscpResourceKind | undefined {
  const details = error.details;
  if (!isRecord(details)) {
    return undefined;
  }

  const resource = details.resource;
  if (!isRecord(resource)) {
    return undefined;
  }

  const type = resource.type;
  if (typeof type !== 'string' || !RESOURCE_KINDS.has(type as AfscpResourceKind)) {
    return undefined;
  }

  return type as AfscpResourceKind;
}

function extractValidationErrors(error: Record<string, unknown>): string[] {
  const details = error.details;
  if (!isRecord(details)) {
    return [];
  }

  const value = details.validation_errors;
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function extractDetailString(error: Record<string, unknown>, key: string): string | undefined {
  const details = error.details;
  if (!isRecord(details)) {
    return undefined;
  }
  return readString(details, key);
}

function parseErrorEnvelope(payload: unknown): ParsedAfscpError {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return { validation_errors: [] };
  }

  const error = payload.error;
  const operationId = readString(error, 'operation_id');
  return {
    code: readString(error, 'code'),
    message: readString(error, 'message'),
    retryable: readBoolean(error, 'retryable'),
    correlation_id: sanitizeAfscpCorrelationId(readString(error, 'correlation_id')),
    operation_id: sanitizeAfscpOperationId(operationId),
    resource_kind: extractResourceKind(error),
    validation_errors: extractValidationErrors(error),
    writer_gate_error_family: extractDetailString(error, 'writer_gate_error_family'),
  };
}

function normalizeHttpStatus(status: number): number {
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return status;
  }
  return 500;
}

function buildMappedError(input: {
  status: number;
  code: AfscpPublicErrorCode;
  retryable: boolean;
  correlation_id?: string;
  operation_id?: string;
  resource_kind?: AfscpResourceKind;
}): AfscpMappedError {
  const output: AfscpMappedError = {
    status: input.status,
    code: input.code,
    message: input.code,
    retryable: input.retryable,
  };
  if (input.correlation_id) {
    output.correlation_id = input.correlation_id;
  }
  if (input.operation_id) {
    output.operation_id = input.operation_id;
  }
  if (input.resource_kind) {
    output.resource_kind = input.resource_kind;
  }
  return output;
}

function hasValidationError(parsed: ParsedAfscpError, label: string): boolean {
  return parsed.validation_errors.includes(label);
}

function parsedMessageIncludes(parsed: ParsedAfscpError, value: string): boolean {
  return parsed.message?.toLowerCase().includes(value) ?? false;
}

function isTemplateCloneDenied(parsed: ParsedAfscpError): boolean {
  return hasValidationError(parsed, 'cross_namespace_template_clone_denied')
    || parsedMessageIncludes(parsed, 'cross-namespace template clone is not allowed');
}

function isRestorePreviewStale(parsed: ParsedAfscpError): boolean {
  return parsed.code === 'RESTORE_PREVIEW_STALE'
    || (parsed.code === 'OPERATION_RECOVERY_REQUIRED' && (
      parsedMessageIncludes(parsed, 'restore preview plan requires operator recovery')
      || parsedMessageIncludes(parsed, 'restore preview plan is not pending')
      || parsedMessageIncludes(parsed, 'restore preview metadata does not match durable plan')
    ));
}

function isWriterBlocker(parsed: ParsedAfscpError): boolean {
  return parsed.code === 'ACTIVE_WRITER_SESSIONS'
    || parsed.code === 'STALE_WRITER_SESSION_UNCERTAIN'
    || parsed.code === 'WRITER_SESSION_FENCE_HELD'
    || parsed.code === 'RESTORE_RUN_WRITER_SESSIONS_DENIED'
    || parsed.writer_gate_error_family === 'ACTIVE_WRITER_SESSIONS'
    || parsed.writer_gate_error_family === 'STALE_WRITER_SESSION_UNCERTAIN';
}

export function mapAfscpErrorEnvelope(status: number, payload: unknown): AfscpMappedError {
  const parsed = parseErrorEnvelope(payload);

  if (isTemplateCloneDenied(parsed)) {
    return buildMappedError({
      status: 403,
      code: 'afscp_template_clone_not_allowed',
      retryable: parsed.retryable ?? false,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (isRestorePreviewStale(parsed)) {
    return buildMappedError({
      status: 409,
      code: 'afscp_restore_preview_stale',
      retryable: parsed.retryable ?? false,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (isWriterBlocker(parsed)) {
    return buildMappedError({
      status: 409,
      code: 'afscp_active_writer_blocks_restore',
      retryable: parsed.retryable ?? false,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (parsed.code === 'REPO_MUTATION_IN_PROGRESS') {
    return buildMappedError({
      status: 409,
      code: 'afscp_repo_mutation_in_progress',
      retryable: parsed.retryable ?? true,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (
    parsed.code === 'RESOURCE_NAMESPACE_MISMATCH'
    || (parsed.code ? NOT_FOUND_ERROR_CODES.has(parsed.code) : status === 404)
  ) {
    return buildMappedError({
      status: 404,
      code: 'afscp_resource_not_found',
      retryable: false,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (parsed.code === 'CAPABILITY_DENIED') {
    return buildMappedError({
      status: 403,
      code: 'afscp_capability_denied',
      retryable: false,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (parsed.code === 'AUTHENTICATION_FAILED' || parsed.code === 'CALLER_NOT_ALLOWED' || parsed.code === 'ROLE_NOT_ALLOWED') {
    return buildMappedError({
      status: normalizeHttpStatus(status),
      code: 'afscp_service_permission_denied',
      retryable: false,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (parsed.code === 'VOLUME_MISMATCH_REQUIRES_IMPORT') {
    return buildMappedError({
      status: 409,
      code: 'afscp_volume_mismatch_requires_admin',
      retryable: false,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (parsed.code === 'OPERATION_RECOVERY_REQUIRED') {
    return buildMappedError({
      status: 409,
      code: 'afscp_operator_recovery_required',
      retryable: parsed.retryable ?? true,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (parsed.code === 'IDEMPOTENCY_CONFLICT') {
    return buildMappedError({
      status: 409,
      code: 'conflict',
      retryable: false,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (parsed.code === 'STORAGE_UNAVAILABLE') {
    return buildMappedError({
      status: 503,
      code: 'unavailable',
      retryable: true,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  if (parsed.code === 'INTERNAL_ERROR') {
    return buildMappedError({
      status: normalizeHttpStatus(status),
      code: 'afscp_service_configuration_error',
      retryable: parsed.retryable ?? false,
      correlation_id: parsed.correlation_id,
      operation_id: parsed.operation_id,
      resource_kind: parsed.resource_kind,
    });
  }

  return buildMappedError({
    status: normalizeHttpStatus(status),
    code: 'afscp_error',
    retryable: parsed.retryable ?? false,
    correlation_id: parsed.correlation_id,
    operation_id: parsed.operation_id,
    resource_kind: parsed.resource_kind,
  });
}
