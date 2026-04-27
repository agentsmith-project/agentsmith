import {
  buildRedactedDiagnostic,
  type RedactedGovernanceDiagnostic,
  type RedactionEnv,
} from './redaction';

export const ORDERED_SENTINEL_PROBES = [
  'internal_execution_ws_base_url_correct',
  'proxy_data_token_present',
  'ticket_auth_present',
  'keycloak_redirect_bases_present',
  'dns_gateway_reachable',
  'provider_profile_present',
  'secret_profile_present',
  'kind_available',
  'registry_available',
  'docker_available',
] as const;

export type SentinelProbeName = typeof ORDERED_SENTINEL_PROBES[number];

export type SentinelProbeContext = {
  env: RedactionEnv;
};

export type SentinelProbe = (context: SentinelProbeContext) => boolean | Promise<boolean>;

export type SentinelPreflightInput = {
  env?: RedactionEnv;
  probes?: Partial<Record<SentinelProbeName, SentinelProbe>>;
};

export type SentinelPreflightResult = {
  exitCode: 0 | 1;
  output: RedactedGovernanceDiagnostic;
};

export type SentinelPreflightCliStreams = {
  stdout: {
    write(chunk: string): unknown;
  };
  stderr: {
    write(chunk: string): unknown;
  };
};

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function normalizeEnvValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function hasAnyEnv(env: RedactionEnv, keys: readonly string[]): boolean {
  return keys.some((key) => Boolean(normalizeEnvValue(env[key])?.trim()));
}

function truthyEnv(env: RedactionEnv, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = normalizeEnvValue(env[key])?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'available';
  });
}

function firstEnv(env: RedactionEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeEnvValue(env[key])?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function internalExecutionWsBaseUrlCorrect(env: RedactionEnv): boolean {
  const value = firstEnv(env, ['INTERNAL_EXECUTION_WS_BASE_URL', 'EXECUTION_WS_BASE_URL']);
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'ws:' || url.protocol === 'wss:')
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
    );
  } catch {
    return false;
  }
}

const DEFAULT_SENTINEL_PROBES: Record<SentinelProbeName, SentinelProbe> = {
  internal_execution_ws_base_url_correct: ({ env }) => internalExecutionWsBaseUrlCorrect(env),
  proxy_data_token_present: ({ env }) => hasAnyEnv(env, ['PROXY_DATA_TOKEN', 'MBOS_PROXY_DATA_TOKEN', 'DATA_PROXY_TOKEN']),
  ticket_auth_present: ({ env }) => hasAnyEnv(env, ['RUNNER_TICKET', 'TASK_TICKET', 'AGENTSMITH_TICKET', 'MBOS_TICKET']),
  keycloak_redirect_bases_present: ({ env }) => hasAnyEnv(env, ['KEYCLOAK_REDIRECT_BASE_URL', 'NEXT_PUBLIC_APP_URL', 'BASE_URL']),
  dns_gateway_reachable: ({ env }) => truthyEnv(env, ['DNS_GATEWAY_REACHABLE', 'GATEWAY_REACHABLE']),
  provider_profile_present: ({ env }) => hasAnyEnv(env, ['PROVIDER_PROFILE', 'LLM_PROVIDER_PROFILE', 'MODEL_PROVIDER_PROFILE', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY']),
  secret_profile_present: ({ env }) => hasAnyEnv(env, ['SECRET_PROFILE', 'SECRET_PROFILE_PATH', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'MANAGED_CREDENTIALS']),
  kind_available: ({ env }) => truthyEnv(env, ['KIND_AVAILABLE']) || hasAnyEnv(env, ['KIND_CLUSTER_NAME']),
  registry_available: ({ env }) => truthyEnv(env, ['REGISTRY_AVAILABLE']) || hasAnyEnv(env, ['REGISTRY_HOST']),
  docker_available: ({ env }) => truthyEnv(env, ['DOCKER_AVAILABLE']) || hasAnyEnv(env, ['DOCKER_HOST']),
};

export async function runSentinelPreflight(input: SentinelPreflightInput = {}): Promise<SentinelPreflightResult> {
  const env = input.env ?? process.env;
  const probePresence: Record<string, boolean> = {};
  let exitCode: 0 | 1 = 0;

  for (const name of ORDERED_SENTINEL_PROBES) {
    const probe = input.probes?.[name] ?? DEFAULT_SENTINEL_PROBES[name];
    let passed = false;
    try {
      passed = await Promise.resolve(probe({ env }));
    } catch {
      passed = false;
    }
    probePresence[`probe.${name}`] = passed;

    if (!passed) {
      exitCode = 1;
      break;
    }
  }

  return {
    exitCode,
    output: buildRedactedDiagnostic({
      env,
      additionalPresence: probePresence,
    }),
  };
}

export function renderSentinelPreflightOutput(output: RedactedGovernanceDiagnostic): string {
  return `${JSON.stringify(output, null, 2)}\n`;
}

export async function runSentinelPreflightCli(
  input: SentinelPreflightInput = {},
  streams: SentinelPreflightCliStreams = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<number> {
  try {
    const result = await runSentinelPreflight(input);
    streams.stdout.write(renderSentinelPreflightOutput(result.output));
    return result.exitCode;
  } catch {
    streams.stderr.write('[sentinel-preflight] diagnostic unavailable\n');
    return 1;
  }
}

if (isCliEntrypoint('sentinel-preflight.ts')) {
  runSentinelPreflightCli()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch(() => {
      process.stderr.write('[sentinel-preflight] diagnostic unavailable\n');
      process.exit(1);
    });
}
