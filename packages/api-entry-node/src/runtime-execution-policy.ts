import {
  classifyUpstreamStatus,
  shouldFallbackByPolicy,
  type RuntimeErrorClass,
  type RuntimeFallbackPolicy,
  type RuntimeRoutingAttempt,
} from './runtime-routing.js';
import type { RuntimeProviderConnectionRecord } from './runtime-store.js';

export type RuntimeExecutionFailure = {
  errorCode: string;
  message: string;
};

type RuntimeReadyProviderConnection = RuntimeProviderConnectionRecord & {
  credential_ref: string;
};

export function selectProviderConnection(params: {
  providers: RuntimeProviderConnectionRecord[];
  attempt: RuntimeRoutingAttempt;
}): { ok: true; providerConnection: RuntimeReadyProviderConnection } | { ok: false; failure: RuntimeExecutionFailure } {
  const available = params.providers
    .filter((item) => item.provider === params.attempt.provider && item.status === 'active')
    .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));

  if (available.length === 0) {
    return {
      ok: false,
      failure: {
        errorCode: 'RUNTIME_PROVIDER_CONNECTION_NOT_FOUND',
        message: 'runtime_provider_connection_not_found',
      },
    };
  }

  const providerConnection = available[0]!;
  if (!providerConnection.credential_ref) {
    return {
      ok: false,
      failure: {
        errorCode: 'RUNTIME_PROVIDER_CREDENTIAL_MISSING',
        message: 'runtime_provider_credential_missing',
      },
    };
  }

  return { ok: true, providerConnection: providerConnection as RuntimeReadyProviderConnection };
}

export function toMissingCredentialFailure(): RuntimeExecutionFailure {
  return {
    errorCode: 'RUNTIME_PROVIDER_CREDENTIAL_NOT_FOUND',
    message: 'runtime_provider_credential_not_found',
  };
}

export function shouldFallbackAfterNetworkError(params: {
  attemptIndex: number;
  attemptCount: number;
  comboFallbackPolicy?: RuntimeFallbackPolicy;
  comboName?: string | null;
}): boolean {
  if (params.attemptIndex >= params.attemptCount - 1) {
    return false;
  }
  return shouldFallbackByPolicy({
    errorClass: 'system_error',
    hopAfterFallback: params.attemptIndex + 1,
    policy: params.comboName ? params.comboFallbackPolicy : undefined,
  });
}

export function evaluateUpstreamFallback(params: {
  attemptIndex: number;
  attemptCount: number;
  upstreamStatus: number;
  comboFallbackPolicy?: RuntimeFallbackPolicy;
  comboName?: string | null;
}): { shouldFallback: boolean; errorClass: RuntimeErrorClass } {
  const errorClass = classifyUpstreamStatus(params.upstreamStatus);
  if (params.upstreamStatus < 400 || params.attemptIndex >= params.attemptCount - 1) {
    return { shouldFallback: false, errorClass };
  }
  return {
    errorClass,
    shouldFallback: shouldFallbackByPolicy({
      errorClass,
      hopAfterFallback: params.attemptIndex + 1,
      policy: params.comboName ? params.comboFallbackPolicy : undefined,
    }),
  };
}
