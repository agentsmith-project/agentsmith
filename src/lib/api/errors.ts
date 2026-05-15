/**
 * API Error Handling
 *
 * Types and utilities for handling API errors.
 */

import type { ErrorResponse } from './types';
import { toast } from '@/components/ui/toast';

// ============================================================
// Error Types
// ============================================================

export class APIError extends Error {
  constructor(
    public errorCode: string,
    message: string,
    public requestId?: string,
    public statusCode?: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'APIError';
  }

  /**
   * Create APIError from response
   */
  static fromResponse(data: ErrorResponse, statusCode?: number): APIError {
    return new APIError(
      data.error_code,
      data.message,
      data.request_id,
      statusCode,
      data.details
    );
  }

  /**
   * Check if error is a network error
   */
  isNetworkError(): boolean {
    return this.errorCode === 'NETWORK_ERROR' || this.errorCode === 'TIMEOUT';
  }

  /**
   * Check if error is an authentication error
   */
  isAuthError(): boolean {
    return this.statusCode === 401 || this.errorCode === 'UNAUTHORIZED';
  }

  /**
   * Check if error is a permission error
   */
  isPermissionError(): boolean {
    return this.statusCode === 403 || this.errorCode === 'FORBIDDEN';
  }

  /**
   * Check if error is a not found error
   */
  isNotFoundError(): boolean {
    return this.statusCode === 404 || this.errorCode === 'NOT_FOUND';
  }

  /**
   * Check if error is a validation error
   */
  isValidationError(): boolean {
    return this.statusCode === 400 || this.errorCode === 'VALIDATION_ERROR';
  }

  /**
   * Check if error is a rate limit error
   */
  isRateLimitError(): boolean {
    return this.statusCode === 429 || this.errorCode === 'RATE_LIMIT_EXCEEDED';
  }

  /**
   * Check if error is a server error
   */
  isServerError(): boolean {
    return this.statusCode !== undefined && this.statusCode >= 500;
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    const safeTaskSurfaceMessage =
      resolveAgentTaskSafeErrorMessage({ rawMessage: this.errorCode, audience: 'task' })
      ?? resolveAgentTaskSafeErrorMessage({ rawMessage: this.message, audience: 'task' });
    if (safeTaskSurfaceMessage) return safeTaskSurfaceMessage;

    // Special error codes with custom messages
    const customMessages: Record<string, string> = {
      NETWORK_ERROR: 'Network connection failed. Please check your internet connection.',
      TIMEOUT: 'Request timed out. Please try again.',
      UNAUTHORIZED: 'You are not authorized. Please log in.',
      FORBIDDEN: 'You do not have permission to perform this action.',
      NOT_FOUND: 'The requested resource was not found.',
      VALIDATION_ERROR: 'Please check your input and try again.',
      RATE_LIMIT_EXCEEDED: 'Too many requests. Please wait and try again.',
      INTERNAL_ERROR: 'An unexpected error occurred. Please try again later.',
      FILE_LIBRARY_CAPABILITY_DENIED: 'Task file templates are not available for this project yet. Ask an admin to enable file templates, then try again.',
      FILE_LIBRARY_OPERATION_PENDING: 'File state is still being updated. Wait for the current file operation to finish, then try again.',
      FILE_LIBRARY_RESTORE_OPERATION_PENDING: 'File state is still being updated. Wait for the current file operation to finish, then try again.',
      FILE_LIBRARY_ACTIVE_WRITER_BLOCKED: 'Task files and workspace are still being used by the task runtime. Release task workspace usage, then try again.',
      FILE_LIBRARY_STORAGE_NOT_READY: 'Project file storage is not ready yet. Wait for initialization to finish, then try again.',
    };

    return customMessages[this.errorCode] || this.message;
  }
}

/**
 * Resolve a user-facing message by error code.
 * Used by feature modules to keep code->message mapping centralized.
 */
export function resolveErrorMessageByCode(
  errorCode: string | null | undefined,
  overrides: Record<string, string>,
  fallback: string,
): string {
  if (!errorCode) return fallback;
  return overrides[errorCode] ?? fallback;
}

export interface ErrorTranslator {
  (key: string, values?: Record<string, string | number>): string;
}

export type AgentTaskErrorAudience = 'task' | 'terminal';

const AGENT_TASK_SAFE_ERROR_CODES = [
  'agent_runner_unavailable',
  'agent_runner_forbidden',
  'agent_runner_runtime_unavailable',
  'agent_runner_model_unconfigured',
  'agent_runner_capability_mismatch',
  'agent_runner_default_conflict',
  'agent_runner_not_resolved',
  'agent_runner_disconnected',
  'agent_runner_stale',
  'invalid_binding_target',
  'terminal_runner_unavailable',
  'terminal_runner_not_resolved',
  'task_terminal_runner_unavailable',
  'task_terminal_runner_not_resolved',
] as const;

const AGENT_TASK_SAFE_ERROR_CODE_SET = new Set<string>(AGENT_TASK_SAFE_ERROR_CODES);

const TASK_SAFE_COPY_DEFAULTS: Record<AgentTaskErrorAudience, string> = {
  task: 'Task execution is not ready yet.',
  terminal: 'Terminal session is not ready. Try reopening it later.',
};

const TASK_SAFE_COPY_KEYS: Record<AgentTaskErrorAudience, string[]> = {
  task: ['agentTaskResolution.description'],
  terminal: ['terminal_error_session_not_ready'],
};

const FILE_LIBRARY_TYPED_ERROR_KEYS: Record<string, string[]> = {
  AGENT_TASK_FILE_LIBRARY_IN_USE: [
    'workspace_file_library_in_use.description',
    'file_library_task_in_use.description',
  ],
  FILE_LIBRARY_TASK_IN_USE: ['file_library_task_in_use.description'],
  FILE_LIBRARY_DELETING: ['file_library_deleting.description'],
  FILE_LIBRARY_NOT_READY: ['file_library_not_ready.description'],
  FILE_LIBRARY_NOT_FOUND: ['file_library_not_found.description'],
  FILE_LIBRARY_FORBIDDEN: ['file_library_forbidden.description'],
  FILE_LIBRARY_NOT_EMPTY: ['file_library_not_empty.description'],
  FILE_LIBRARY_CAPABILITY_DENIED: ['file_library_capability_denied.description'],
  FILE_LIBRARY_OPERATION_PENDING: ['file_library_operation_pending.description'],
  FILE_LIBRARY_RESTORE_OPERATION_PENDING: ['file_library_operation_pending.description'],
  FILE_LIBRARY_ACTIVE_WRITER_BLOCKED: ['file_library_active_writer_blocked.description'],
  FILE_LIBRARY_STORAGE_NOT_READY: ['file_library_storage_not_ready.description'],
  AGENT_TASK_WORKSPACE_BINDING_CONFLICT: ['agent_task_workspace_binding_conflict.description'],
  AGENT_TASK_WORKSPACE_FILE_LIBRARY_REQUIRED: ['agent_task_workspace_file_library_required.description'],
  AGENT_TASK_WORKSPACE_MODE_INVALID: ['agent_task_workspace_mode_invalid.description'],
};

const FILE_LIBRARY_TYPED_ERROR_DEFAULTS: Record<string, string> = {
  FILE_LIBRARY_CAPABILITY_DENIED: 'Task file templates are not available for this project yet. Ask an admin to enable file templates, then try again.',
  FILE_LIBRARY_OPERATION_PENDING: 'File state is still being updated. Wait for the current file operation to finish, then try again.',
  FILE_LIBRARY_RESTORE_OPERATION_PENDING: 'File state is still being updated. Wait for the current file operation to finish, then try again.',
  FILE_LIBRARY_ACTIVE_WRITER_BLOCKED: 'Task files and workspace are still being used by the task runtime. Release task workspace usage, then try again.',
  FILE_LIBRARY_STORAGE_NOT_READY: 'Project file storage is not ready yet. Wait for initialization to finish, then try again.',
};

const AGENT_TASK_TYPED_ERROR_KEYS: Record<string, string[]> = {
  AGENT_TASK_DELETE_BLOCKED: ['agent_task_delete_blocked.description'],
};

const AGENT_TASK_UNSAFE_ERROR_TERMS = [
  'runner',
  'system managed',
  'endpoint',
  'model configuration',
  'connection key',
  'required_permissions',
  'reason_code',
  'diagnostics',
  'diagnostic id',
  'diagnostic entrypoint',
  'raw event',
  'raw diagnostics',
  'internal path',
  'internal_path',
] as const;

function normalizeErrorToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function findAgentTaskSafeErrorCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeErrorToken(value);
  if (AGENT_TASK_SAFE_ERROR_CODE_SET.has(normalized)) {
    return normalized;
  }
  for (const code of AGENT_TASK_SAFE_ERROR_CODES) {
    if (normalized.includes(code)) {
      return code;
    }
  }
  return null;
}

export function containsAgentTaskUnsafeErrorTerm(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return AGENT_TASK_UNSAFE_ERROR_TERMS.some((term) => normalized.includes(term));
}

function pickTranslated(
  t: ErrorTranslator,
  keys: string[],
  fallback: string,
  values?: Record<string, string | number>,
): string {
  for (const key of keys) {
    const value = t(key, values);
    if (value && value !== key) return value;
  }
  return fallback;
}

function resolveTypedConflictErrorMessage(args: {
  error: APIError;
  t: ErrorTranslator;
  fallback: string;
}): string | null {
  const keys =
    AGENT_TASK_TYPED_ERROR_KEYS[args.error.errorCode]
    ?? FILE_LIBRARY_TYPED_ERROR_KEYS[args.error.errorCode];
  if (!keys) return null;
  return pickTranslated(
    args.t,
    keys,
    FILE_LIBRARY_TYPED_ERROR_DEFAULTS[args.error.errorCode] ?? args.fallback,
  );
}

export function resolveAgentTaskSafeErrorMessage(args: {
  rawMessage: string | null | undefined;
  audience?: AgentTaskErrorAudience;
  t?: ErrorTranslator;
}): string | null {
  if (!findAgentTaskSafeErrorCode(args.rawMessage)) return null;
  const audience = args.audience ?? 'task';
  const fallback = TASK_SAFE_COPY_DEFAULTS[audience];
  if (!args.t) return fallback;
  return pickTranslated(args.t, TASK_SAFE_COPY_KEYS[audience], fallback);
}

function pickErrorDetailString(
  details: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = details?.[key];
  return typeof value === 'string' ? value : null;
}

export function resolveApiErrorPresentation(args: {
  error: APIError;
  t: ErrorTranslator;
  context?: string;
  fallbackMessage?: string;
}): { title: string; description: string } {
  const { error, t, context, fallbackMessage } = args;
  const unknownTitle = pickTranslated(t, ['unknown.title'], 'Error');
  const unknownDescription = pickTranslated(t, ['unknown.description'], 'An unexpected error occurred.');
  const defaultDescription = error.message || fallbackMessage || unknownDescription;
  const safeTaskSurfaceDescription =
    resolveAgentTaskSafeErrorMessage({ rawMessage: error.errorCode, audience: 'task', t })
    ?? resolveAgentTaskSafeErrorMessage({ rawMessage: error.message, audience: 'task', t })
    ?? resolveAgentTaskSafeErrorMessage({
      rawMessage: pickErrorDetailString(error.details, 'reason_code'),
      audience: 'task',
      t,
    })
    ?? resolveAgentTaskSafeErrorMessage({
      rawMessage: pickErrorDetailString(error.details, 'failure_code'),
      audience: 'task',
      t,
    })
    ?? resolveAgentTaskSafeErrorMessage({
      rawMessage: pickErrorDetailString(error.details, 'error_code'),
      audience: 'task',
      t,
    });

  if (safeTaskSurfaceDescription) {
    return {
      title: pickTranslated(t, ['agentTaskResolution.title'], 'Task not ready'),
      description: safeTaskSurfaceDescription,
    };
  }

  const typedConflictDescription = resolveTypedConflictErrorMessage({
    error,
    t,
    fallback: fallbackMessage || unknownDescription,
  });
  if (typedConflictDescription) {
    return {
      title: pickTranslated(t, ['conflict.title'], 'Conflict'),
      description: typedConflictDescription,
    };
  }

  if (error.errorCode === 'AGENT_OFFLINE') {
    return {
      title: pickTranslated(t, ['agentOffline.title'], unknownTitle),
      description: pickTranslated(t, ['agentOffline.description'], defaultDescription),
    };
  }
  if (error.errorCode === 'AGENT_TIMEOUT') {
    return {
      title: pickTranslated(t, ['agentTimeout.title'], unknownTitle),
      description: pickTranslated(t, ['agentTimeout.description'], defaultDescription),
    };
  }
  if (error.errorCode === 'AGENT_PROTOCOL_ERROR') {
    return {
      title: pickTranslated(t, ['agentProtocol.title'], unknownTitle),
      description: pickTranslated(t, ['agentProtocol.description'], defaultDescription),
    };
  }
  if (error.errorCode === 'AGENT_UPSTREAM_ERROR') {
    return {
      title: pickTranslated(t, ['agentUpstream.title'], unknownTitle),
      description: pickTranslated(t, ['agentUpstream.description'], defaultDescription),
    };
  }

  switch (error.statusCode) {
    case 400:
      return {
        title: pickTranslated(t, ['badRequest.title'], 'Invalid Request'),
        description: error.message || pickTranslated(t, ['badRequest.description'], defaultDescription),
      };
    case 401:
      return {
        title: pickTranslated(t, ['unauthorized.title', 'unauthorizedError.title'], 'Authentication Required'),
        description: pickTranslated(
          t,
          ['unauthorized.description', 'unauthorizedError.description'],
          defaultDescription,
        ),
      };
    case 403:
      return {
        title: pickTranslated(t, ['forbidden.title', 'forbiddenError.title'], 'Access Denied'),
        description: pickTranslated(
          t,
          ['forbidden.description', 'forbiddenError.description'],
          defaultDescription,
        ),
      };
    case 404:
      return {
        title: pickTranslated(t, ['notFound.title', 'notFoundError.title'], 'Not Found'),
        description: context
          ? pickTranslated(
            t,
            ['notFound.withContext', 'notFoundError.withContext'],
            `${context} not found`,
            { context },
          )
          : pickTranslated(
            t,
            ['notFound.description', 'notFoundError.description'],
            defaultDescription,
          ),
      };
    case 409:
      return {
        title: pickTranslated(t, ['conflict.title'], 'Conflict'),
        description: error.message || pickTranslated(t, ['conflict.description'], defaultDescription),
      };
    case 429:
      return {
        title: pickTranslated(t, ['rateLimit.title', 'rateLimitError.title'], 'Too Many Requests'),
        description: pickTranslated(
          t,
          ['rateLimit.description', 'rateLimitError.description'],
          defaultDescription,
        ),
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        title: pickTranslated(t, ['serverError.title'], 'Server Error'),
        description: pickTranslated(t, ['serverError.description'], defaultDescription),
      };
    default:
      return {
        title: unknownTitle,
        description: defaultDescription,
      };
  }
}

// ============================================================
// Error Parsing Utilities
// ============================================================

/**
 * Parse error from fetch response
 */
export async function parseErrorResponse(response: Response): Promise<APIError> {
  try {
    const data = await response.json();
    if (isErrorResponse(data)) {
      return APIError.fromResponse(data, response.status);
    }
  } catch {
    // If parsing fails, create a generic error
  }

  // Generic error if we can't parse the response
  return new APIError(
    'UNKNOWN_ERROR',
    response.statusText || 'An unknown error occurred',
    '',
    response.status
  );
}

/**
 * Check if object is an ErrorResponse
 */
export function isErrorResponse(obj: unknown): obj is ErrorResponse {
  if (!isObjectRecord(obj)) return false;
  return typeof obj.error_code === 'string'
    && typeof obj.message === 'string'
    && (obj.request_id === undefined || typeof obj.request_id === 'string')
    && (obj.details === undefined || isObjectRecord(obj.details));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse error from EventSource (SSE)
 */
export function parseSSEError(event: MessageEvent): APIError | null {
  try {
    const data = JSON.parse(event.data);
    if (isErrorResponse(data)) {
      return APIError.fromResponse(data);
    }
  } catch {
    return null;
  }
  return null;
}

// ============================================================
// Error Message Formatting
// ============================================================

/**
 * Format error for toast notification
 */
export function formatErrorForToast(error: APIError | Error, t?: (key: string) => string): string {
  if (error instanceof APIError) {
    return error.getUserMessage();
  }
  if (t) {
    return error.message || t('unknown_error');
  }
  return error.message || 'An unexpected error occurred';
}

/**
 * Handle error and show toast (non-hook version for use in callbacks)
 * This can be used in React Query onError callbacks where hooks can't be used
 */
export function handleErrorForToast(error: unknown, context?: string): void {
  if (error instanceof APIError) {
    const message = formatErrorForToast(error);
    toast.error(message);
    if (context) {
      console.error(`[${context}]`, error);
    }
  } else if (error instanceof Error) {
    toast.error(error.message || 'An unexpected error occurred');
    if (context) {
      console.error(`[${context}]`, error);
    }
  } else {
    toast.error('An unexpected error occurred');
    if (context) {
      console.error(`[${context}]`, error);
    }
  }
}

/**
 * Format error with request ID for debugging
 */
export function formatErrorWithRequestID(error: APIError | Error): string {
  if (error instanceof APIError && error.requestId) {
    return `${error.getUserMessage()}\n\nRequest ID: ${error.requestId}`;
  }
  return error.message || 'An unexpected error occurred';
}

/**
 * Copy request ID to clipboard (for user to report)
 */
export async function copyRequestID(error: APIError): Promise<boolean> {
  if (!error.requestId) return false;

  try {
    await navigator.clipboard.writeText(error.requestId);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Error Handlers
// ============================================================

/**
 * Handle API error with appropriate actions
 */
export function handleAPIError(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  if (error instanceof Error) {
    // Convert standard errors to APIError
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return new APIError('NETWORK_ERROR', error.message, '', undefined);
    }

    if (error.name === 'AbortError') {
      return new APIError('TIMEOUT', 'Request was cancelled or timed out', '', undefined);
    }

    return new APIError('UNKNOWN_ERROR', error.message, '', undefined);
  }

  return new APIError('UNKNOWN_ERROR', 'An unknown error occurred', '', undefined);
}

/**
 * Get error handling suggestions
 */
export function getErrorSuggestions(error: APIError): string[] {
  const suggestions: string[] = [];

  if (error.isNetworkError() || error.isServerError()) {
    suggestions.push('Check your internet connection');
    suggestions.push('Try refreshing the page');
    suggestions.push('If the problem persists, contact support');
  }

  if (error.isAuthError()) {
    suggestions.push('You may need to log in again');
    suggestions.push('Your session may have expired');
  }

  if (error.isPermissionError()) {
    suggestions.push('You do not have permission to perform this action');
    suggestions.push('Contact your project administrator for access');
  }

  if (error.isRateLimitError()) {
    suggestions.push('You have made too many requests');
    suggestions.push('Please wait a moment before trying again');
  }

  if (error.isValidationError()) {
    suggestions.push('Check your input for any errors');
    suggestions.push('Make sure all required fields are filled');
  }

  if (error.requestId) {
    suggestions.push(`Request ID: ${error.requestId} (include this when reporting issues)`);
  }

  return suggestions;
}
