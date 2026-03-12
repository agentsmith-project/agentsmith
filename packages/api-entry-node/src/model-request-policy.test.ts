import { describe, expect, it } from 'vitest';
import {
  evaluateUpstreamFallback,
  selectProviderConnection,
  shouldFallbackAfterNetworkError,
  toMissingCredentialFailure,
} from './model-request-policy.js';
import type { ProviderConnectionRecord } from './model-config-store.js';

const baseProvider: ProviderConnectionRecord = {
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

describe('model-request-policy', () => {
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
        errorCode: 'PROVIDER_CONNECTION_NOT_FOUND',
        message: 'provider_connection_not_found',
      },
    });

    expect(selectProviderConnection({
      providers: [{ ...baseProvider, credential_ref: undefined }],
      attempt: { provider: 'openai', model: 'gpt-4o' },
    })).toEqual({
      ok: false,
      failure: {
        errorCode: 'PROVIDER_CREDENTIAL_MISSING',
        message: 'provider_credential_missing',
      },
    });

    expect(toMissingCredentialFailure()).toEqual({
      errorCode: 'PROVIDER_CREDENTIAL_NOT_FOUND',
      message: 'provider_credential_not_found',
    });
  });

  it('evaluates upstream errors with no fallback in MVP mode', () => {
    expect(shouldFallbackAfterNetworkError()).toBe(false);
    expect(evaluateUpstreamFallback({
      upstreamStatus: 429,
    })).toEqual({
      errorClass: 'provider_retryable',
      shouldFallback: false,
    });

    expect(evaluateUpstreamFallback({
      upstreamStatus: 400,
    })).toEqual({
      errorClass: 'provider_non_retryable',
      shouldFallback: false,
    });
  });
});
