import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}));

import {
  APIError,
  containsAgentTaskUnsafeErrorTerm,
  containsUserFacingUnsafeInfrastructureTerm,
  formatErrorForToast,
  handleErrorForToast,
  findAgentTaskSafeErrorCode,
  isErrorResponse,
  parseErrorResponse,
  resolveApiErrorPresentation,
  resolveErrorMessageByCode,
  resolveSafeRouteErrorPresentation,
} from '@/lib/api/errors';

beforeEach(() => {
  mockToastError.mockClear();
});

describe('resolveErrorMessageByCode', () => {
  it('returns mapped message when code exists', () => {
    const message = resolveErrorMessageByCode(
      'AGENT_TIMEOUT',
      { AGENT_TIMEOUT: 'agent timeout' },
      'fallback',
    );
    expect(message).toBe('agent timeout');
  });

  it('returns fallback when code is missing', () => {
    const message = resolveErrorMessageByCode(
      'UNKNOWN',
      { AGENT_TIMEOUT: 'agent timeout' },
      'fallback',
    );
    expect(message).toBe('fallback');
  });
});

describe('parseErrorResponse', () => {
  it('parses typed error payloads without request_id', async () => {
    const response = new Response(JSON.stringify({
      error_code: 'FILE_LIBRARY_NOT_READY',
      message: 'file_library_not_ready',
      details: {
        file_library_id: 'flib_1',
      },
    }), {
      status: 409,
      statusText: 'Conflict',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const error = await parseErrorResponse(response);

    expect(error).toBeInstanceOf(APIError);
    expect(error.errorCode).toBe('FILE_LIBRARY_NOT_READY');
    expect(error.message).toBe('file_library_not_ready');
    expect(error.requestId).toBeUndefined();
    expect(error.statusCode).toBe(409);
    expect(error.details).toEqual({
      file_library_id: 'flib_1',
    });
  });

  it('rejects malformed typed error shapes without falling through type safety', () => {
    expect(isErrorResponse({
      error_code: 'FILE_LIBRARY_NOT_READY',
      message: 'file_library_not_ready',
      request_id: 123,
    })).toBe(false);
  });
});

describe('resolveApiErrorPresentation', () => {
  const t = (key: string) => {
    const dict: Record<string, string> = {
      'agentProtocol.title': 'Agent Protocol Error',
      'agentProtocol.description': 'The external agent returned an invalid protocol payload.',
      'agentTaskResolution.title': 'Task not ready',
      'agentTaskResolution.description': 'Task execution is not ready yet.',
      'file_library_deleting.description': 'This library is being deleted. Refresh the library status before trying again.',
      'file_library_not_ready.description': 'This library is not ready yet. Refresh the library status before trying again.',
      'file_library_task_in_use.description': 'Delete the bound task before deleting this library.',
      'workspace_file_library_in_use.description': 'That task workspace is now bound to another task. Select another workspace or create a new one.',
      'file_library_capability_denied.description': 'Task file templates are not available for this project yet. Ask an admin to enable file templates, then try again.',
      'file_library_operation_pending.description': 'A file update is still running. Wait for it to finish, then try again.',
      'file_library_active_writer_blocked.description': 'Task files are still in use. Release task file usage, then try again.',
      'file_library_storage_not_ready.description': 'Project file storage is not ready yet. Wait for initialization to finish, then try again.',
      'agent_task_delete_blocked.description':
        'Delete is blocked because this task still has an active run, terminal session, or task workspace in use. Finish those blockers and try again.',
      'rateLimitError.title': 'Too Many Requests',
      'rateLimitError.description': 'Please wait a moment before trying again.',
      'unknown.title': 'Error',
      'unknown.description': 'An unexpected error occurred.',
    };
    return dict[key] ?? key;
  };

  const ordinaryTaskDenylist = [
    /agent_runner_/i,
    /runner/i,
    /system managed/i,
    /endpoint/i,
    /model configuration/i,
    /connection key/i,
    /required_permissions/i,
    /reason_code/i,
    /diagnostics/i,
    /diagnostic id/i,
    /diagnostic entrypoint/i,
    /raw event/i,
    /raw diagnostics/i,
    /internal path/i,
  ];

  it('maps external agent protocol code to dedicated copy', () => {
    const presentation = resolveApiErrorPresentation({
      error: new APIError('AGENT_PROTOCOL_ERROR', 'agent_response_delta_invalid', 'req-1', 502),
      t,
    });
    expect(presentation.title).toBe('Agent Protocol Error');
    expect(presentation.description).toBe('The external agent returned an invalid protocol payload.');
  });

  it('supports 429 translation key rateLimitError.*', () => {
    const presentation = resolveApiErrorPresentation({
      error: new APIError('RATE_LIMIT_EXCEEDED', 'Too many requests', 'req-2', 429),
      t,
    });
    expect(presentation.title).toBe('Too Many Requests');
    expect(presentation.description).toBe('Please wait a moment before trying again.');
  });

  it.each([
    ['FILE_LIBRARY_DELETING', 'file_library_deleting', 'This library is being deleted. Refresh the library status before trying again.'],
    ['FILE_LIBRARY_NOT_READY', 'file_library_not_ready', 'This library is not ready yet. Refresh the library status before trying again.'],
    ['FILE_LIBRARY_TASK_IN_USE', 'file_library_task_in_use', 'Delete the bound task before deleting this library.'],
    ['AGENT_TASK_FILE_LIBRARY_IN_USE', 'workspace_file_library_in_use', 'That task workspace is now bound to another task. Select another workspace or create a new one.'],
    ['FILE_LIBRARY_CAPABILITY_DENIED', 'file_library_capability_denied', 'Task file templates are not available for this project yet. Ask an admin to enable file templates, then try again.'],
    ['FILE_LIBRARY_OPERATION_PENDING', 'file_library_operation_pending', 'A file update is still running. Wait for it to finish, then try again.'],
    ['FILE_LIBRARY_SAVE_POINT_OPERATION_PENDING', 'file_library_save_point_create_pending', 'A file update is still running. Wait for it to finish, then try again.'],
    ['FILE_LIBRARY_RESTORE_OPERATION_PENDING', 'file_library_restore_operation_pending', 'A file update is still running. Wait for it to finish, then try again.'],
    ['FILE_LIBRARY_ACTIVE_WRITER_BLOCKED', 'file_library_active_writer_blocked', 'Task files are still in use. Release task file usage, then try again.'],
    ['FILE_LIBRARY_STORAGE_NOT_READY', 'storage not ready', 'Project file storage is not ready yet. Wait for initialization to finish, then try again.'],
    ['AGENT_TASK_DELETE_BLOCKED', 'agent_task_delete_blocked', 'Delete is blocked because this task still has an active run, terminal session, or task workspace in use. Finish those blockers and try again.'],
  ])('maps typed conflict %s through i18n instead of rendering %s', (errorCode, rawMessage, expectedDescription) => {
    const presentation = resolveApiErrorPresentation({
      error: new APIError(errorCode, rawMessage, 'req-file-conflict', 409, {
        file_library_id: 'lib_a',
      }),
      t,
    });

    expect(presentation.title).toBe('Conflict');
    expect(presentation.description).toBe(expectedDescription);
    expect(presentation.description).not.toBe(rawMessage);
  });

  it('returns a productized toast message for template capability denial', () => {
    const userMessage = new APIError(
      'FILE_LIBRARY_CAPABILITY_DENIED',
      'file_library_capability_denied',
      'req-file-template',
      403,
    ).getUserMessage();

    expect(userMessage).toBe(
      'Task file templates are not available for this project yet. Ask an admin to enable file templates, then try again.',
    );
    expect(userMessage).not.toContain('file_library_capability_denied');
    expect(userMessage).not.toContain('FILE_LIBRARY_CAPABILITY_DENIED');
  });

  it.each([
    ['FILE_LIBRARY_OPERATION_PENDING', 'file_library_operation_pending', 'A file update is still running. Wait for it to finish, then try again.'],
    ['FILE_LIBRARY_SAVE_POINT_OPERATION_PENDING', 'file_library_save_point_list_pending', 'A file update is still running. Wait for it to finish, then try again.'],
    ['FILE_LIBRARY_RESTORE_OPERATION_PENDING', 'file_library_restore_operation_pending', 'A file update is still running. Wait for it to finish, then try again.'],
    ['FILE_LIBRARY_ACTIVE_WRITER_BLOCKED', 'file_library_active_writer_blocked', 'Task files are still in use. Release task file usage, then try again.'],
    ['FILE_LIBRARY_STORAGE_NOT_READY', 'storage not ready', 'Project file storage is not ready yet. Wait for initialization to finish, then try again.'],
  ])('returns a productized toast message for %s', (errorCode, rawMessage, expectedMessage) => {
    const userMessage = new APIError(
      errorCode,
      rawMessage,
      'req-file-operation-pending',
      409,
    ).getUserMessage();

    expect(userMessage).toBe(expectedMessage);
    expect(userMessage).not.toBe(rawMessage);
    expect(userMessage).not.toContain(rawMessage);
    expect(userMessage).not.toContain(errorCode);
  });

  it.each([
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
  ])('maps %s to ordinary task-safe copy', (errorCode) => {
    const presentation = resolveApiErrorPresentation({
      error: new APIError(errorCode, errorCode, 'req-runner-resolution', 409, {
        reason_code: errorCode,
        required_permissions: ['project:agent_runner:read'],
        diagnostics: {
          diagnostic_id: 'diag_123',
          diagnostic_entrypoint: '/internal/runner/default/raw-event',
          internal_path: '/internal/runner/default',
          raw_event: { reason_code: errorCode },
          raw_diagnostics: 'required_permissions=project:agent_runner:read',
        },
      }),
      t,
    });

    expect(presentation).toEqual({
      title: 'Task not ready',
      description: 'Task execution is not ready yet.',
    });
    const renderedCopy = `${presentation.title} ${presentation.description}`;
    expect(renderedCopy).not.toContain(errorCode);
    for (const denied of ordinaryTaskDenylist) {
      expect(renderedCopy).not.toMatch(denied);
    }
  });

  it.each([
    ['FORBIDDEN', 'agent_runner_forbidden'],
    ['RESOURCE_CONFLICT', 'agent_runner_runtime_unavailable'],
    ['VALIDATION_ERROR', 'invalid_binding_target'],
  ])('returns a safe toast message for %s / %s without leaking runner codes', (errorCode, message) => {
    const userMessage = new APIError(errorCode, message, 'req-safe-toast', 409, {
      reason_code: message,
    }).getUserMessage();

    expect(userMessage).toBe('Task execution is not ready yet.');
    expect(userMessage).not.toContain(message);
    for (const denied of ordinaryTaskDenylist) {
      expect(userMessage).not.toMatch(denied);
    }
  });

  it.each([
    'agent_runner_selection_required',
    'agent_runner_selection_ambiguous',
  ])('does not classify %s as task-safe copy', (errorCode) => {
    expect(findAgentTaskSafeErrorCode(errorCode)).toBeNull();
  });

  it.each([
    'runner',
    'System managed',
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
    'ASBCP_INTERNAL_BASE_URL=http://asbcp.agentsmith.svc.cluster.local',
    'ASBCP_SERVICE_KEY leaked',
    'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v1@sha256:1234',
    'sandbox workload failed',
    'control plane unavailable',
  ])('recognizes ordinary task unsafe copy term "%s"', (term) => {
    expect(containsAgentTaskUnsafeErrorTerm(term)).toBe(true);
  });

  it.each([
    'ASBCP failed with internal error',
    'ASBCP_INTERNAL_BASE_URL=http://asbcp.agentsmith.svc.cluster.local',
    'ASBCP_SERVICE_KEY is missing',
    'ASBCP_IMAGE=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v1.0.0@sha256:abcdef1234567890',
    'The control plane failed sandbox workload lifecycle checks',
    'internal URL http://asbcp.agentsmith.svc.cluster.local:28080',
    'service DNS asbcp.agentsmith.svc.cluster.local failed',
    'localhost:28080 refused the connection',
  ])('recognizes unsafe infrastructure detail "%s"', (term) => {
    expect(containsUserFacingUnsafeInfrastructureTerm(term)).toBe(true);
  });

  it.each([
    [400, 'VALIDATION_ERROR'],
    [409, 'RESOURCE_CONFLICT'],
  ])('sanitizes unsafe infrastructure details for API presentation status %s', (statusCode, errorCode) => {
    const presentation = resolveApiErrorPresentation({
      error: new APIError(
        errorCode,
        'ASBCP_INTERNAL_BASE_URL=http://asbcp.agentsmith.svc.cluster.local ASBCP_SERVICE_KEY=secret image ghcr.io/app@sha256:abcdef localhost',
        'req-unsafe-api',
        statusCode,
      ),
      t,
    });

    expect(presentation.description).toBe('An unexpected error occurred.');
    expect(presentation.description).not.toMatch(/ASBCP|ASBCP_SERVICE_KEY|ghcr\.io|sha256|svc\.cluster\.local|localhost/i);
  });

  it('preserves readable safe business conflict messages', () => {
    const presentation = resolveApiErrorPresentation({
      error: new APIError('RESOURCE_CONFLICT', 'Project name already exists.', 'req-safe-conflict', 409),
      t,
    });

    expect(presentation).toEqual({
      title: 'Conflict',
      description: 'Project name already exists.',
    });
    expect(new APIError('RESOURCE_CONFLICT', 'Project name already exists.', 'req-safe-conflict', 409).getUserMessage())
      .toBe('Project name already exists.');
  });

  it('sanitizes APIError and ordinary Error toast paths without hiding safe messages', () => {
    const unsafeApiError = new APIError(
      'RESOURCE_CONFLICT',
      'ASBCP_SERVICE_KEY leaked through localhost and ghcr.io/app@sha256:abcdef',
      'req-toast',
      409,
    );
    const unsafeError = new Error('ASBCP_INTERNAL_BASE_URL http://asbcp.agentsmith.svc.cluster.local localhost');

    expect(unsafeApiError.getUserMessage()).toBe('An unexpected error occurred. Please try again.');
    expect(formatErrorForToast(unsafeError)).toBe('An unexpected error occurred');

    handleErrorForToast(unsafeApiError);
    handleErrorForToast(unsafeError);
    handleErrorForToast(new Error('Workspace name already exists.'));

    expect(mockToastError).toHaveBeenNthCalledWith(1, 'An unexpected error occurred. Please try again.');
    expect(mockToastError).toHaveBeenNthCalledWith(2, 'An unexpected error occurred');
    expect(mockToastError).toHaveBeenNthCalledWith(3, 'Workspace name already exists.');
  });

  it('uses safe route boundary copy while retaining only a public error id', () => {
    const presentation = resolveSafeRouteErrorPresentation({
      error: Object.assign(
        new Error(
          'ASBCP_INTERNAL_BASE_URL http://asbcp.agentsmith.svc.cluster.local ASBCP_SERVICE_KEY ghcr.io/image@sha256:abcdef1234567890',
        ),
        { digest: 'err_digest_123' },
      ),
      t,
    });

    expect(presentation).toEqual({
      description: 'An unexpected error occurred. Please try again.',
      reference: {
        labelKey: 'error_id',
        value: 'err_digest_123',
      },
    });
    expect(presentation.description).not.toMatch(/ASBCP|ASBCP_SERVICE_KEY|ghcr\.io|sha256|svc\.cluster\.local/i);
  });
});
