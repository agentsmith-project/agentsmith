import { normalizeAfscpValidatedValue } from './afscp-validation.js';

export type AfscpConfig =
  | { enabled: false }
  | {
      enabled: true;
      baseUrl: string;
      callerService: string;
      serviceToken: string;
      bootstrapServiceToken: string;
      defaultVolumeId: string;
      bootstrapCallerService: string;
      orchestratorCallerService: string;
    };

export type AfscpConfigErrorCode = 'AFSCP_CONFIG_INCOMPLETE' | 'AFSCP_CONFIG_INVALID';

export class AfscpConfigError extends Error {
  readonly code: AfscpConfigErrorCode;
  readonly missing?: string[];
  readonly invalid?: string[];

  constructor(input: { code: AfscpConfigErrorCode; missing?: string[]; invalid?: string[] }) {
    super(`afscp_config_error:${input.code}`);
    this.name = 'AfscpConfigError';
    this.code = input.code;
    this.missing = input.missing;
    this.invalid = input.invalid;
  }

  toJSON(): { code: AfscpConfigErrorCode; missing?: string[]; invalid?: string[] } {
    return {
      code: this.code,
      ...(this.missing ? { missing: this.missing } : {}),
      ...(this.invalid ? { invalid: this.invalid } : {}),
    };
  }
}

const REQUIRED_ENV_KEYS = [
  'AFSCP_BASE_URL',
  'AFSCP_CALLER_SERVICE',
  'AFSCP_SERVICE_TOKEN',
  'AFSCP_BOOTSTRAP_SERVICE_TOKEN',
  'AFSCP_DEFAULT_VOLUME_ID',
  'AFSCP_BOOTSTRAP_CALLER_SERVICE',
  'AFSCP_ORCHESTRATOR_CALLER_SERVICE',
] as const;

type RequiredEnvKey = typeof REQUIRED_ENV_KEYS[number];
type AfscpEnv = Record<string, string | undefined>;

function readEnvValue(env: AfscpEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function normalizeAfscpBaseUrl(rawBaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new AfscpConfigError({ code: 'AFSCP_CONFIG_INVALID', invalid: ['AFSCP_BASE_URL'] });
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.search || parsed.hash) {
    throw new AfscpConfigError({ code: 'AFSCP_CONFIG_INVALID', invalid: ['AFSCP_BASE_URL'] });
  }

  return parsed.toString().replace(/\/+$/, '');
}

export function parseAfscpConfig(env: AfscpEnv = process.env): AfscpConfig {
  const values: Partial<Record<RequiredEnvKey, string>> = {};
  for (const key of REQUIRED_ENV_KEYS) {
    const value = readEnvValue(env, key);
    if (value) {
      values[key] = value;
    }
  }

  const configuredRequiredKeys = REQUIRED_ENV_KEYS.filter((key) => values[key]);
  if (configuredRequiredKeys.length === 0) {
    return { enabled: false };
  }

  const missing = REQUIRED_ENV_KEYS.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new AfscpConfigError({ code: 'AFSCP_CONFIG_INCOMPLETE', missing });
  }

  const baseUrl = values.AFSCP_BASE_URL;
  const callerService = values.AFSCP_CALLER_SERVICE;
  const serviceToken = values.AFSCP_SERVICE_TOKEN;
  const bootstrapServiceToken = values.AFSCP_BOOTSTRAP_SERVICE_TOKEN;
  const defaultVolumeId = values.AFSCP_DEFAULT_VOLUME_ID;
  const bootstrapCallerService = values.AFSCP_BOOTSTRAP_CALLER_SERVICE;
  const orchestratorCallerService = values.AFSCP_ORCHESTRATOR_CALLER_SERVICE;
  if (
    !baseUrl
    || !callerService
    || !serviceToken
    || !bootstrapServiceToken
    || !defaultVolumeId
    || !bootstrapCallerService
    || !orchestratorCallerService
  ) {
    throw new AfscpConfigError({ code: 'AFSCP_CONFIG_INCOMPLETE', missing });
  }

  const invalid: string[] = [];
  const normalizedCallerService = normalizeAfscpValidatedValue('caller_service', callerService);
  const normalizedBootstrapCallerService = normalizeAfscpValidatedValue('caller_service', bootstrapCallerService);
  const normalizedOrchestratorCallerService = normalizeAfscpValidatedValue('caller_service', orchestratorCallerService);
  const normalizedDefaultVolumeId = normalizeAfscpValidatedValue('volume_id', defaultVolumeId);
  if (!normalizedCallerService) {
    invalid.push('AFSCP_CALLER_SERVICE');
  }
  if (!normalizedBootstrapCallerService) {
    invalid.push('AFSCP_BOOTSTRAP_CALLER_SERVICE');
  }
  if (!normalizedOrchestratorCallerService) {
    invalid.push('AFSCP_ORCHESTRATOR_CALLER_SERVICE');
  }
  if (!normalizedDefaultVolumeId) {
    invalid.push('AFSCP_DEFAULT_VOLUME_ID');
  }
  if (invalid.length > 0) {
    throw new AfscpConfigError({ code: 'AFSCP_CONFIG_INVALID', invalid });
  }
  if (
    !normalizedCallerService
    || !normalizedBootstrapCallerService
    || !normalizedOrchestratorCallerService
    || !normalizedDefaultVolumeId
  ) {
    throw new AfscpConfigError({ code: 'AFSCP_CONFIG_INVALID', invalid });
  }

  if (normalizedBootstrapCallerService === normalizedCallerService) {
    throw new AfscpConfigError({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_BOOTSTRAP_CALLER_SERVICE'],
    });
  }
  if (normalizedOrchestratorCallerService === normalizedCallerService) {
    throw new AfscpConfigError({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_ORCHESTRATOR_CALLER_SERVICE'],
    });
  }
  if (normalizedOrchestratorCallerService === normalizedBootstrapCallerService) {
    throw new AfscpConfigError({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_ORCHESTRATOR_CALLER_SERVICE'],
    });
  }
  if (bootstrapServiceToken === serviceToken) {
    throw new AfscpConfigError({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_BOOTSTRAP_SERVICE_TOKEN'],
    });
  }

  return {
    enabled: true,
    baseUrl: normalizeAfscpBaseUrl(baseUrl),
    callerService: normalizedCallerService,
    serviceToken,
    bootstrapServiceToken,
    defaultVolumeId: normalizedDefaultVolumeId,
    bootstrapCallerService: normalizedBootstrapCallerService,
    orchestratorCallerService: normalizedOrchestratorCallerService,
  };
}
