import type { ProviderConnectionRecord } from './model-config-store.js';

export type ProviderErrorClass = 'provider_retryable' | 'provider_non_retryable' | 'system_error';

export type ModelRequestAttempt = {
  provider: string;
  model: string;
};
export type ModelRequestFailure = {
  errorCode: string;
  message: string;
};

type ReadyProviderConnection = ProviderConnectionRecord & {
  credential_ref: string;
};

export function selectProviderConnection(params: {
  providers: ProviderConnectionRecord[];
  attempt: ModelRequestAttempt;
}): { ok: true; providerConnection: ReadyProviderConnection } | { ok: false; failure: ModelRequestFailure } {
  const available = params.providers
    .filter((item) => item.provider === params.attempt.provider && item.status === 'active')
    .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));

  if (available.length === 0) {
    return {
      ok: false,
      failure: {
        errorCode: 'PROVIDER_CONNECTION_NOT_FOUND',
        message: 'provider_connection_not_found',
      },
    };
  }

  const providerConnection = available[0]!;
  if (!providerConnection.credential_ref) {
    return {
      ok: false,
      failure: {
        errorCode: 'PROVIDER_CREDENTIAL_MISSING',
        message: 'provider_credential_missing',
      },
    };
  }

  return { ok: true, providerConnection: providerConnection as ReadyProviderConnection };
}

export function toMissingCredentialFailure(): ModelRequestFailure {
  return {
    errorCode: 'PROVIDER_CREDENTIAL_NOT_FOUND',
    message: 'provider_credential_not_found',
  };
}

export function classifyUpstreamStatus(status: number): ProviderErrorClass {
  if (status == 429 || status >= 500) return 'provider_retryable';
  if (status >= 400) return 'provider_non_retryable';
  return 'system_error';
}

export function shouldFallbackAfterNetworkError(): boolean {
  return false;
}

export function evaluateUpstreamFallback(params: {
  upstreamStatus: number;
}): { shouldFallback: boolean; errorClass: ProviderErrorClass } {
  const errorClass = classifyUpstreamStatus(params.upstreamStatus);
  return { shouldFallback: false, errorClass };
}
