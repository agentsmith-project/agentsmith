import { describe, expect, it } from 'vitest';
import {
  evaluateUpstreamFallback,
  selectProviderConnection,
  shouldFallbackAfterNetworkError,
  toMissingCredentialFailure,
} from './runtime-execution-policy.js';
import type { RuntimeProviderConnectionRecord } from './runtime-store.js';

const baseProvider: RuntimeProviderConnectionRecord = {
  id: 'rpc_1',
  workspace_id: 'ws_default',
  project_id: 'proj_1',
  provider: 'openai',
  auth_mode: 'api_key',
  base_url: 'https://api.openai.com/v1',
  credential_ref: 'cred_1',
  status: 'active',
  created_at: '2026-02-28T00:00:00.000Z',
  updated_at: '2026-02-28T00:00:00.000Z',
};

describe('runtime-execution-policy', () => {
  it('selects the highest-priority active provider connection', () => {
    const result = selectProviderConnection({
      providers: [
        { ...baseProvider, id: 'rpc_2', priority: 5 },
        { ...baseProvider, id: 'rpc_1', priority: 1 },
      ],
      attempt: { provider: 'openai', model: 'gpt-4o' },
    });
    expect(result).toEqual({
      ok: true,
      providerConnection: { ...baseProvider, id: 'rpc_1', priority: 1 },
    });
  });

  it('maps missing connection and missing credential to stable failures', () => {
    expect(selectProviderConnection({
      providers: [],
      attempt: { provider: 'openai', model: 'gpt-4o' },
    })).toEqual({
      ok: false,
      failure: {
        errorCode: 'RUNTIME_PROVIDER_CONNECTION_NOT_FOUND',
        message: 'runtime_provider_connection_not_found',
      },
    });

    expect(selectProviderConnection({
      providers: [{ ...baseProvider, credential_ref: undefined }],
      attempt: { provider: 'openai', model: 'gpt-4o' },
    })).toEqual({
      ok: false,
      failure: {
        errorCode: 'RUNTIME_PROVIDER_CREDENTIAL_MISSING',
        message: 'runtime_provider_credential_missing',
      },
    });

    expect(toMissingCredentialFailure()).toEqual({
      errorCode: 'RUNTIME_PROVIDER_CREDENTIAL_NOT_FOUND',
      message: 'runtime_provider_credential_not_found',
    });
  });

  it('evaluates fallback policy for network and upstream errors', () => {
    expect(shouldFallbackAfterNetworkError({
      attemptIndex: 0,
      attemptCount: 2,
      comboName: 'prod-chat',
      comboFallbackPolicy: { max_hops: 1, retryable_error_classes: ['system_error'] },
    })).toBe(true);

    expect(shouldFallbackAfterNetworkError({
      attemptIndex: 1,
      attemptCount: 2,
      comboName: 'prod-chat',
      comboFallbackPolicy: { max_hops: 1, retryable_error_classes: ['system_error'] },
    })).toBe(false);

    expect(evaluateUpstreamFallback({
      attemptIndex: 0,
      attemptCount: 2,
      upstreamStatus: 429,
      comboName: 'prod-chat',
      comboFallbackPolicy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
    })).toEqual({
      errorClass: 'provider_retryable',
      shouldFallback: true,
    });

    expect(evaluateUpstreamFallback({
      attemptIndex: 0,
      attemptCount: 2,
      upstreamStatus: 400,
      comboName: 'prod-chat',
      comboFallbackPolicy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
    })).toEqual({
      errorClass: 'provider_non_retryable',
      shouldFallback: false,
    });
  });
});
