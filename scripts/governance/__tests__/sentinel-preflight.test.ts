import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ORDERED_SENTINEL_PROBES,
  SENTINEL_PROFILE_PROBES,
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

describe('sentinel preflight', () => {
  it.each([
    ['release-ready', [
      'provider_profile_present',
      'secret_profile_present',
    ]],
    ['verify-real', [
      'provider_profile_present',
      'secret_profile_present',
    ]],
    ['verify-release-real', [
      'provider_profile_present',
      'secret_profile_present',
    ]],
    ['demo-rehearsal', [
      'kind_available',
      'registry_available',
    ]],
    ['cluster-rehearsal', [
      'kind_available',
      'registry_available',
    ]],
  ] satisfies Array<[SentinelProfile, SentinelProbeName[]]>)(
    'runs only the necessary %s sentinel probes',
    async (profile, expectedProbes) => {
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
      expect(SENTINEL_PROFILE_PROBES[profile]).toEqual(expectedProbes);
      expect(calls).toEqual(expectedProbes);
      expect(calls).not.toEqual([...ORDERED_SENTINEL_PROBES]);
    },
  );

  it('runs fixture-friendly probes and fail-fast stops at the first failed profile diagnostic', async () => {
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
    expect(calls).toEqual([
      'provider_profile_present',
      'secret_profile_present',
    ]);
    expect(result.output.presence['probe.secret_profile_present']).toBe(false);
    expect(result.output.presence['probe.provider_profile_present']).toBe(true);
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
