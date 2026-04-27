import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ORDERED_SENTINEL_PROBES,
  renderSentinelPreflightOutput,
  runSentinelPreflight,
  runSentinelPreflightCli,
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
  it('runs fixture-friendly probes and fail-fast stops at the first failed diagnostic', async () => {
    const calls: SentinelProbeName[] = [];
    const result = await runSentinelPreflight({
      env: {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        INTERNAL_EXECUTION_WS_BASE_URL: 'ws://localhost:20000/api/v1/execution/ws',
        PROXY_DATA_TOKEN: 'proxy-token-raw-value',
        RUNNER_TICKET: 'runner-ticket-raw-value',
      },
      probes: probeMap({ dns_gateway_reachable: false }, calls),
    });

    expect(result.exitCode).toBe(1);
    expect(calls).toEqual([
      'internal_execution_ws_base_url_correct',
      'proxy_data_token_present',
      'ticket_auth_present',
      'keycloak_redirect_bases_present',
      'dns_gateway_reachable',
    ]);
    expect(result.output.presence['probe.dns_gateway_reachable']).toBe(false);
    expect(result.output.presence['probe.provider_profile_present']).toBeUndefined();
  });

  it('does not produce a verdict while still returning an exit code for the wrapper', async () => {
    const result = await runSentinelPreflight({
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
      dns_gateway_reachable: async () => {
        calls.push('dns_gateway_reachable');
        throw new Error(
          'probe exploded Authorization: Bearer thrown-probe-raw-token sk-thrown-probe-raw-value ticket=thrown-ticket-raw-value',
        );
      },
    };

    const exitCode = await runSentinelPreflightCli({
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
    expect(parsed.presence['probe.dns_gateway_reachable']).toBe(false);
    expect(parsed.presence['probe.provider_profile_present']).toBeUndefined();
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
