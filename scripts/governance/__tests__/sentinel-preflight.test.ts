import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ORDERED_SENTINEL_PROBES,
  SENTINEL_PROFILE_PROBE_MATRIX,
  SENTINEL_PROFILE_PROBES,
  buildSentinelPreflightEnv,
  renderSentinelPreflightOutput,
  runSentinelPreflight,
  runSentinelPreflightCli,
  type SentinelProfile,
  type SentinelProbeName,
} from '../sentinel-preflight';
import { findRedactionLeaks } from '../redaction';

function probeMap(
  values: Partial<Record<SentinelProbeName, boolean>>,
  calls: SentinelProbeName[],
) {
  return Object.fromEntries(
    ORDERED_SENTINEL_PROBES.map((name) => [
      name,
      async () => {
        calls.push(name);
        return values[name] ?? true;
      },
    ]),
  );
}

function probePresenceKeys(output: { presence: Record<string, boolean> }): string[] {
  return Object.keys(output.presence)
    .filter((key) => key.startsWith('probe.'))
    .sort((left, right) => left.localeCompare(right));
}

function writeEnv(root: string, path: string, lines: readonly string[]): void {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${lines.join('\n')}\n`);
}

function writeCurrentHydrationShape(root: string): void {
  writeEnv(root, 'infra/runtime/presets.env', [
    'PRESET_ENDPOINT_MODEL=placeholder-model',
    'PRESET_OPENAI_ENDPOINT_BASE_URL=https://openai-compatible.provider.example/v1',
  ]);
  writeEnv(root, 'infra/runtime/backend-real.env', [
    'INTEGRATION_API_PORT=20040',
    'INTEGRATION_WEB_PORT=3041',
  ]);
  writeEnv(root, '.env.backend-real', [
    'PRESET_ENDPOINT_API_KEY=sk-test-current-hydration-value',
    'PRESET_ENDPOINT_MODEL=test-current-hydration-model',
  ]);
  writeEnv(root, 'infra/flows/demo-rehearsal.env', [
    'LOCAL_KIND_CLUSTER_NAME=agentsmith-demo',
    'LOCAL_KIND_REGISTRY_HOST=127.0.0.1',
    'LOCAL_KIND_REGISTRY_HOST_PORT=5003',
    'FLOW_SITE_ENV_PUBLIC_WEB_BASE_URL=http://localhost:33001',
    'FLOW_SITE_ENV_PUBLIC_API_BASE_URL=http://localhost:40000',
  ]);
  writeEnv(root, 'infra/flows/cluster-rehearsal.env', [
    'LOCAL_KIND_CLUSTER_NAME=agentsmith-cluster',
    'LOCAL_KIND_REGISTRY_HOST=127.0.0.1',
    'LOCAL_KIND_REGISTRY_HOST_PORT=5002',
    'CLUSTER_REHEARSAL_REGISTRY_HOST=localhost:5002',
    'CLUSTER_REHEARSAL_K8S_REGISTRY_HOST=agentsmith-cluster-registry:5000',
    'FLOW_SITE_ENV_PUBLIC_WEB_BASE_URL=http://localhost:43001',
    'FLOW_SITE_ENV_PUBLIC_API_BASE_URL=http://localhost:41000/api/v1',
  ]);
  writeEnv(root, 'artifacts/runtime/scenario/demo-rehearsal/config/site.env', [
    'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=demo-proxy-admin-token',
    'PRESET_ENDPOINT_API_KEY=sk-test-demo-rehearsal-value',
    'PRESET_ENDPOINT_MODEL=test-demo-rehearsal-model',
  ]);
  writeEnv(root, 'artifacts/runtime/scenario/cluster-rehearsal/config/site.env', [
    'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=cluster-proxy-admin-token',
    'PRESET_ENDPOINT_API_KEY=sk-test-cluster-rehearsal-value',
    'PRESET_ENDPOINT_MODEL=test-cluster-rehearsal-model',
  ]);
  writeEnv(root, 'artifacts/runtime/scenario/cluster-rehearsal/config/registry.env', [
    'REGISTRY_HOST=localhost:5002',
    'K8S_REGISTRY_HOST=agentsmith-cluster-registry:5000',
  ]);
  writeEnv(root, 'env/registry.env', [
    'REGISTRY_HOST=localhost:5002',
    'K8S_REGISTRY_HOST=agentsmith-cluster-registry:5000',
  ]);
}

describe('sentinel preflight', () => {
  it.each([
    ['release-ready', [
      'keycloak_redirect_bases_present',
      'provider_profile_present',
      'secret_profile_present',
    ]],
    ['verify-real', [
      'keycloak_redirect_bases_present',
      'provider_profile_present',
      'secret_profile_present',
    ]],
    ['verify-release-real', [
      'keycloak_redirect_bases_present',
      'provider_profile_present',
      'secret_profile_present',
    ]],
    ['demo-rehearsal', [
      'keycloak_redirect_bases_present',
      'provider_profile_present',
      'secret_profile_present',
      'kind_available',
      'registry_available',
    ]],
    ['cluster-rehearsal', [
      'keycloak_redirect_bases_present',
      'provider_profile_present',
      'secret_profile_present',
      'kind_available',
      'registry_available',
    ]],
  ] satisfies Array<[SentinelProfile, SentinelProbeName[]]>)(
    'reports the full P0 probe catalog for %s while classifying required probes',
    async (profile, expectedRequiredProbes) => {
      const calls: SentinelProbeName[] = [];
      const result = await runSentinelPreflight({
        profile,
        env: {
          NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
          INTERNAL_EXECUTION_WS_BASE_URL: 'ws://localhost:20000/api/v1/execution/ws',
          PROXY_DATA_TOKEN: 'proxy-token-raw-value',
          RUNNER_TICKET: 'runner-ticket-raw-value',
          KEYCLOAK_REDIRECT_BASE_URL: 'http://localhost:3000',
          DNS_GATEWAY_REACHABLE: 'true',
          PROVIDER_PROFILE: 'provider-present',
          SECRET_PROFILE: 'secret-present',
          KIND_AVAILABLE: 'true',
          REGISTRY_AVAILABLE: 'true',
          DOCKER_AVAILABLE: 'true',
        },
        probes: probeMap({}, calls),
      });

      expect(result.exitCode).toBe(0);
      expect(SENTINEL_PROFILE_PROBES[profile]).toEqual(expectedRequiredProbes);
      expect(calls).toEqual([...ORDERED_SENTINEL_PROBES]);
      expect(probePresenceKeys(result.output)).toEqual(
        ORDERED_SENTINEL_PROBES
          .map((name) => `probe.${name}`)
          .sort((left, right) => left.localeCompare(right)),
      );
      for (const name of ORDERED_SENTINEL_PROBES) {
        expect(SENTINEL_PROFILE_PROBE_MATRIX[profile][name]).toMatch(/^(required|advisory)$/);
      }
    },
  );

  it('exits 1 when a required profile probe fails and still emits the full catalog', async () => {
    const calls: SentinelProbeName[] = [];
    const result = await runSentinelPreflight({
      profile: 'release-ready',
      env: {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        INTERNAL_EXECUTION_WS_BASE_URL: 'ws://localhost:20000/api/v1/execution/ws',
        PROXY_DATA_TOKEN: 'proxy-token-raw-value',
        RUNNER_TICKET: 'runner-ticket-raw-value',
      },
      probes: probeMap({ secret_profile_present: false }, calls),
    });

    expect(result.exitCode).toBe(1);
    expect(calls).toEqual([...ORDERED_SENTINEL_PROBES]);
    expect(result.output.presence['probe.secret_profile_present']).toBe(false);
    expect(result.output.presence['probe.provider_profile_present']).toBe(true);
    expect(probePresenceKeys(result.output)).toHaveLength(ORDERED_SENTINEL_PROBES.length);
  });

  it('does not fail when advisory probes are missing from the current wrapper-visible env', async () => {
    const calls: SentinelProbeName[] = [];
    const result = await runSentinelPreflight({
      profile: 'verify-real',
      env: {},
      probes: probeMap({
        internal_execution_ws_base_url_correct: false,
        proxy_data_token_absent: false,
        ticket_auth_present: false,
        keycloak_redirect_bases_present: true,
        dns_gateway_reachable: false,
        provider_profile_present: true,
        secret_profile_present: true,
        kind_available: false,
        registry_available: false,
        docker_available: false,
      }, calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([...ORDERED_SENTINEL_PROBES]);
    expect(result.output.presence['probe.ticket_auth_present']).toBe(false);
    expect(result.output.presence['probe.docker_available']).toBe(false);
    expect(result.output.presence['probe.keycloak_redirect_bases_present']).toBe(true);
  });

  it.each([
    'demo-rehearsal',
    'cluster-rehearsal',
  ] satisfies SentinelProfile[])(
    'fails %s when KIND_AVAILABLE is explicitly false and no kind identity is present',
    async (profile) => {
      const result = await runSentinelPreflight({
        profile,
        env: {
          KEYCLOAK_REDIRECT_BASE_URL: 'http://localhost:33001',
          PROVIDER_PROFILE: 'provider-present',
          SECRET_PROFILE: 'secret-present',
          KIND_AVAILABLE: 'false',
          REGISTRY_HOST: 'localhost:5003',
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.output.presence['tool.kind']).toBe(true);
      expect(result.output.presence['probe.kind_available']).toBe(false);
      expect(result.output.presence['probe.registry_available']).toBe(true);
    },
  );

  it.each([
    'demo-rehearsal',
    'cluster-rehearsal',
  ] satisfies SentinelProfile[])(
    'fails %s when REGISTRY_AVAILABLE is explicitly false and no registry identity is present',
    async (profile) => {
      const result = await runSentinelPreflight({
        profile,
        env: {
          KEYCLOAK_REDIRECT_BASE_URL: 'http://localhost:33001',
          PROVIDER_PROFILE: 'provider-present',
          SECRET_PROFILE: 'secret-present',
          KIND_CLUSTER_NAME: 'agentsmith-demo',
          REGISTRY_AVAILABLE: 'false',
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.output.presence['tool.registry']).toBe(true);
      expect(result.output.presence['probe.kind_available']).toBe(true);
      expect(result.output.presence['probe.registry_available']).toBe(false);
    },
  );

  it('treats explicit false availability flags as authoritative even when identity keys are present', async () => {
    const result = await runSentinelPreflight({
      profile: 'demo-rehearsal',
      env: {
        KEYCLOAK_REDIRECT_BASE_URL: 'http://localhost:33001',
        PROVIDER_PROFILE: 'provider-present',
        SECRET_PROFILE: 'secret-present',
        KIND_AVAILABLE: 'false',
        KIND_CLUSTER_NAME: 'agentsmith-demo',
        REGISTRY_AVAILABLE: 'false',
        REGISTRY_HOST: 'localhost:5003',
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.output.presence['tool.kind']).toBe(true);
    expect(result.output.presence['tool.registry']).toBe(true);
    expect(result.output.presence['probe.kind_available']).toBe(false);
    expect(result.output.presence['probe.registry_available']).toBe(false);
  });

  it.each([
    'release-ready',
    'verify-real',
    'verify-release-real',
    'demo-rehearsal',
    'cluster-rehearsal',
  ] satisfies SentinelProfile[])(
    'passes %s with the current hydrated env shape without ticket or docker signals',
    async (profile) => {
      const root = mkdtempSync(join(tmpdir(), 'agentsmith-sentinel-current-env-'));
      try {
        writeCurrentHydrationShape(root);
        const env = buildSentinelPreflightEnv({
          profile,
          cwd: root,
          env: {},
        });
        const result = await runSentinelPreflight({ profile, env });

        expect(result.exitCode).toBe(0);
        expect(result.output.presence['probe.ticket_auth_present']).toBe(false);
        expect(result.output.presence['probe.docker_available']).toBe(false);
        expect(probePresenceKeys(result.output)).toHaveLength(ORDERED_SENTINEL_PROBES.length);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('recognizes rendered rehearsal proxy and internal execution WS aliases as observed probes', async () => {
    const rawProxyToken = 'scenario-proxy-data-token-raw-value';
    const result = await runSentinelPreflight({
      profile: 'demo-rehearsal',
      env: {
        AGENT_EXECUTION_WS_BASE_URL: 'ws://172.18.0.1:40000',
        MBOS_UNIVERSAL_PROXY_DATA_TOKEN: rawProxyToken,
        LLM_UNIVERSAL_PROXY_DATA_TOKEN: 'scenario-llm-proxy-token-raw-value',
        KEYCLOAK_REDIRECT_BASE_URL: 'http://localhost:33001',
        PROVIDER_PROFILE: 'provider-present',
        SECRET_PROFILE: 'secret-present',
        KIND_CLUSTER_NAME: 'agentsmith-demo',
        REGISTRY_HOST: 'localhost:5003',
      },
    });
    const rendered = renderSentinelPreflightOutput(result.output);

    expect(result.exitCode).toBe(0);
    expect(result.output.presence['probe.internal_execution_ws_base_url_correct']).toBe(true);
    expect(result.output.presence['probe.proxy_data_token_absent']).toBe(false);
    expect(result.output.presence['endpoint.internal_ws']).toBe(true);
    expect(result.output.presence['auth.proxy_data_token']).toBe(true);
    expect(rendered).not.toContain('172.18.0.1');
    expect(rendered).not.toContain(rawProxyToken);
    expect(rendered).not.toContain('scenario-llm-proxy-token-raw-value');
    expect(findRedactionLeaks(rendered)).toEqual([]);
  });

  it('returns a fixed unknown-profile error without leaking secret-like input', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSentinelPreflightCli({
      profile: 'Bearer unknown-profile-raw-token' as SentinelProfile,
      env: {
        AUTHORIZATION: 'Bearer sentinel-cli-raw-token',
        OPENAI_API_KEY: 'sk-sentinel-cli-raw-value',
      },
      probes: probeMap({}, []),
    }, {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
    });

    const rendered = `${stdout.join('')}\n${stderr.join('')}`;

    expect(exitCode).toBe(1);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('[sentinel-preflight] unknown profile\n');
    expect(rendered).not.toContain('unknown-profile-raw-token');
    expect(rendered).not.toContain('sentinel-cli-raw-token');
    expect(rendered).not.toContain('sk-sentinel-cli-raw-value');
    expect(findRedactionLeaks(rendered)).toEqual([]);
  });

  it('does not produce a verdict while still returning an exit code for the wrapper', async () => {
    const result = await runSentinelPreflight({
      profile: 'release-ready',
      env: {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        INTERNAL_EXECUTION_WS_BASE_URL: 'ws://localhost:20000/api/v1/execution/ws',
      },
      probes: probeMap({}, []),
    });

    const rendered = renderSentinelPreflightOutput(result.output);
    const parsed = JSON.parse(rendered) as Record<string, unknown>;

    expect(result.exitCode).toBe(0);
    expect(Object.keys(parsed).sort()).toEqual([
      'port_family',
      'presence',
      'profile_digest',
      'public_endpoint',
    ]);
    expect(rendered).not.toMatch(/verdict|release_ready|ready|blocked|passed|failed|status/i);
  });

  it('redacts secret-bearing env values from sentinel diagnostics', async () => {
    const result = await runSentinelPreflight({
      profile: 'release-ready',
      env: {
        NEXT_PUBLIC_API_BASE: 'https://api.example.test:20000/api/v1?access_token=query-token',
        INTERNAL_EXECUTION_WS_BASE_URL: 'wss://api.example.test:20000/api/v1/execution/ws?ticket=query-ticket',
        AUTHORIZATION: 'Bearer sentinel-bearer-raw-value',
        OPENAI_API_KEY: 'sk-sentinel-raw-value',
        API_KEY: 'api_key=sentinel-api-key-raw-value',
        ACCESS_TOKEN: 'access_token=sentinel-access-token-raw-value',
        REFRESH_TOKEN: 'refresh_token=sentinel-refresh-token-raw-value',
        OAUTH_TOKEN: 'oauth_token=sentinel-oauth-raw-value',
        CLIENT_SECRET: 'client_secret=sentinel-client-secret-raw-value',
        PASSWORD: 'sentinel-password-raw-value',
        RUNNER_TICKET: 'sentinel-ticket-raw-value',
        MANAGED_CREDENTIALS: JSON.stringify({ feishu: 'sentinel-managed-credential-raw-value' }),
        COOKIE: 'sid=sentinel-cookie-raw-value',
      },
      probes: probeMap({}, []),
    });

    const rendered = renderSentinelPreflightOutput(result.output);

    expect(findRedactionLeaks(result.output)).toEqual([]);
    expect(result.output.public_endpoint).toBe('https://api.example.test:20000');
    expect(result.output.port_family).toBe('api-20000');
    expect(rendered).not.toContain('Bearer ');
    expect(rendered).not.toContain('sk-sentinel');
    expect(rendered).not.toContain('api_key=');
    expect(rendered).not.toContain('access_token=');
    expect(rendered).not.toContain('refresh_token=');
    expect(rendered).not.toContain('oauth_token=');
    expect(rendered).not.toContain('client_secret=');
    expect(rendered).not.toContain('query-token');
    expect(rendered).not.toContain('query-ticket');
    expect(rendered).not.toContain('sentinel-password-raw-value');
    expect(rendered).not.toContain('sentinel-ticket-raw-value');
    expect(rendered).not.toContain('sentinel-managed-credential-raw-value');
    expect(rendered).not.toContain('sentinel-cookie-raw-value');
  });

  it('turns thrown probe errors into fixed diagnostics without writing raw secrets to CLI output', async () => {
    const calls: SentinelProbeName[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const probes = {
      ...probeMap({}, calls),
      secret_profile_present: async () => {
        calls.push('secret_profile_present');
        throw new Error(
          'probe exploded Authorization: Bearer thrown-probe-raw-token sk-thrown-probe-raw-value ticket=thrown-ticket-raw-value',
        );
      },
    };

    const exitCode = await runSentinelPreflightCli({
      profile: 'release-ready',
      env: {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        INTERNAL_EXECUTION_WS_BASE_URL: 'ws://localhost:20000/api/v1/execution/ws',
        PROXY_DATA_TOKEN: 'proxy-token-raw-value',
        RUNNER_TICKET: 'runner-ticket-raw-value',
      },
      probes,
    }, {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
    });

    const rendered = `${stdout.join('')}\n${stderr.join('')}`;
    const parsed = JSON.parse(stdout.join('')) as {
      presence: Record<string, boolean | undefined>;
    };

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toBe('');
    expect(parsed.presence['probe.secret_profile_present']).toBe(false);
    expect(parsed.presence['probe.provider_profile_present']).toBe(true);
    expect(rendered).not.toContain('probe exploded');
    expect(rendered).not.toContain('Authorization');
    expect(rendered).not.toContain('Bearer');
    expect(rendered).not.toContain('thrown-probe-raw-token');
    expect(rendered).not.toContain('sk-thrown-probe-raw-value');
    expect(rendered).not.toContain('ticket=thrown-ticket-raw-value');
    expect(findRedactionLeaks(rendered)).toEqual([]);
  });

  it('uses a fixed diagnostic for the direct entrypoint outer catch', () => {
    const source = readFileSync('scripts/governance/sentinel-preflight.ts', 'utf8');

    expect(source).toContain("process.stderr.write('[sentinel-preflight] diagnostic unavailable\\n')");
    expect(source).not.toContain('error instanceof Error ? error.message : String(error)');
  });
});
