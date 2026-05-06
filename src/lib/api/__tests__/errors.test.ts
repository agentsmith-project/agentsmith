import { describe, expect, it } from 'vitest';
import {
  APIError,
  containsAgentTaskUnsafeErrorTerm,
  findAgentTaskSafeErrorCode,
  resolveApiErrorPresentation,
  resolveErrorMessageByCode,
} from '@/lib/api/errors';

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

describe('resolveApiErrorPresentation', () => {
  const t = (key: string) => {
    const dict: Record<string, string> = {
      'agentProtocol.title': 'Agent Protocol Error',
      'agentProtocol.description': 'The external agent returned an invalid protocol payload.',
      'agentTaskResolution.title': 'Task not ready',
      'agentTaskResolution.description': 'Task execution is not ready yet.',
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
  ])('recognizes ordinary task unsafe copy term "%s"', (term) => {
    expect(containsAgentTaskUnsafeErrorTerm(term)).toBe(true);
  });
});
