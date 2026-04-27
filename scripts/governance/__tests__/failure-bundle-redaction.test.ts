import { describe, expect, it } from 'vitest';

import {
  buildRedactedFailureBundle,
  findRedactionLeaks,
  redactSensitiveText,
  type RedactedGovernanceDiagnostic,
} from '../redaction';

const SECRET_VALUES = {
  bearer: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret-signature',
  sk: 'sk-live-1234567890abcdef',
  apiKey: 'api_key=api-key-raw-value',
  accessToken: 'access_token=access-token-raw-value',
  refreshToken: 'refresh_token=refresh-token-raw-value',
  oauth: 'oauth_token=oauth-token-raw-value',
  clientSecret: 'client_secret=client-secret-raw-value',
  password: 'p@ssw0rd-raw-value',
  ticket: 'ticket-runner-raw-value',
  managedCredential: 'managed-credential-raw-value',
  cookie: 'sessionid=cookie-raw-value',
  authorization: 'Basic authorization-raw-value',
} as const;

function stringifyDiagnostic(diagnostic: RedactedGovernanceDiagnostic): string {
  return JSON.stringify(diagnostic);
}

describe('failure bundle redaction', () => {
  it('only emits presence booleans, profile digest, public endpoint, and port family', () => {
    const diagnostic = buildRedactedFailureBundle({
      env: {
        NEXT_PUBLIC_API_BASE: 'https://api.example.test:20000/api/v1?access_token=query-token',
        INTERNAL_EXECUTION_WS_BASE_URL: 'wss://api.example.test:20000/api/v1/execution/ws?ticket=query-ticket',
        AUTHORIZATION: SECRET_VALUES.bearer,
        OPENAI_API_KEY: SECRET_VALUES.sk,
        LEGACY_API_KEY: SECRET_VALUES.apiKey,
        ACCESS_TOKEN: SECRET_VALUES.accessToken,
        REFRESH_TOKEN: SECRET_VALUES.refreshToken,
        OAUTH_TOKEN: SECRET_VALUES.oauth,
        CLIENT_SECRET: SECRET_VALUES.clientSecret,
        DATABASE_PASSWORD: SECRET_VALUES.password,
        RUNNER_TICKET: SECRET_VALUES.ticket,
        MANAGED_CREDENTIALS: JSON.stringify({ feishu: SECRET_VALUES.managedCredential }),
        COOKIE: SECRET_VALUES.cookie,
      },
    });

    expect(Object.keys(diagnostic).sort()).toEqual([
      'port_family',
      'presence',
      'profile_digest',
      'public_endpoint',
    ]);
    expect(Object.values(diagnostic.presence).every((value) => typeof value === 'boolean')).toBe(true);
    expect(diagnostic.profile_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(diagnostic.public_endpoint).toBe('https://api.example.test:20000');
    expect(diagnostic.port_family).toBe('api-20000');
  });

  it('does not leak raw secret-bearing values from failure bundle env', () => {
    const diagnostic = buildRedactedFailureBundle({
      env: {
        NEXT_PUBLIC_API_BASE: 'https://api.example.test:20000/api/v1?access_token=query-token',
        NEXT_PUBLIC_APP_URL: 'https://app.example.test/login?ticket=query-ticket',
        AUTHORIZATION: SECRET_VALUES.authorization,
        BEARER_TOKEN: SECRET_VALUES.bearer,
        OPENAI_API_KEY: SECRET_VALUES.sk,
        LEGACY_API_KEY: SECRET_VALUES.apiKey,
        ACCESS_TOKEN: SECRET_VALUES.accessToken,
        REFRESH_TOKEN: SECRET_VALUES.refreshToken,
        OAUTH_TOKEN: SECRET_VALUES.oauth,
        CLIENT_SECRET: SECRET_VALUES.clientSecret,
        DATABASE_PASSWORD: SECRET_VALUES.password,
        RUNNER_TICKET: SECRET_VALUES.ticket,
        MANAGED_CREDENTIALS: JSON.stringify({ feishu: SECRET_VALUES.managedCredential }),
        COOKIE: SECRET_VALUES.cookie,
      },
    });

    const serialized = stringifyDiagnostic(diagnostic);
    const leaks = findRedactionLeaks(diagnostic);

    expect(leaks).toEqual([]);
    expect(serialized).not.toContain('Bearer ');
    expect(serialized).not.toContain('sk-live-');
    expect(serialized).not.toContain('api_key=');
    expect(serialized).not.toContain('access_token=');
    expect(serialized).not.toContain('refresh_token=');
    expect(serialized).not.toContain('oauth_token=');
    expect(serialized).not.toContain('client_secret=');
    expect(serialized).not.toContain('query-token');
    expect(serialized).not.toContain('query-ticket');
    Object.values(SECRET_VALUES).forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('keeps profile digest stable for the same secret profile and changes when the profile changes', () => {
    const first = buildRedactedFailureBundle({
      env: {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        OPENAI_API_KEY: 'sk-live-profile-one',
        RUNNER_TICKET: 'ticket-profile-one',
      },
    });
    const again = buildRedactedFailureBundle({
      env: {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        OPENAI_API_KEY: 'sk-live-profile-one',
        RUNNER_TICKET: 'ticket-profile-one',
      },
    });
    const changed = buildRedactedFailureBundle({
      env: {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        OPENAI_API_KEY: 'sk-live-profile-two',
        RUNNER_TICKET: 'ticket-profile-one',
      },
    });

    expect(first.profile_digest).toBe(again.profile_digest);
    expect(first.profile_digest).not.toBe(changed.profile_digest);
    expect(stringifyDiagnostic(first)).not.toContain('profile-one');
    expect(stringifyDiagnostic(changed)).not.toContain('profile-two');
  });

  it('does not use the internal execution WS URL as the public endpoint', () => {
    const diagnostic = buildRedactedFailureBundle({
      env: {
        INTERNAL_EXECUTION_WS_BASE_URL: 'wss://internal-control.example.test:20000/api/v1/execution/ws?ticket=internal-ticket-raw-value',
      },
    });

    expect(diagnostic.public_endpoint).toBe(null);
    expect(diagnostic.port_family).toBe('unknown');
    expect(diagnostic.presence['endpoint.internal_ws']).toBe(true);
    expect(diagnostic.presence['endpoint.public']).toBe(false);
    expect(stringifyDiagnostic(diagnostic)).not.toContain('internal-control.example.test');
    expect(stringifyDiagnostic(diagnostic)).not.toContain('internal-ticket-raw-value');
  });

  it('keeps alias-based high-level presence aligned without leaking proxy tokens', () => {
    const diagnostic = buildRedactedFailureBundle({
      env: {
        AGENT_EXECUTION_WS_BASE_URL: 'ws://172.18.0.1:40000/execution/ws',
        MBOS_UNIVERSAL_PROXY_DATA_TOKEN: 'mbos-proxy-data-token-raw-value',
        LLM_UNIVERSAL_PROXY_DATA_TOKEN: 'llm-proxy-data-token-raw-value',
        PRESET_ENDPOINT_MODEL: 'alias-model',
        PRESET_ENDPOINT_API_KEY: 'sk-redaction-alias-raw-value',
        PRESET_OPENAI_ENDPOINT_BASE_URL: 'https://provider.example.test/v1',
      },
    });

    const serialized = stringifyDiagnostic(diagnostic);

    expect(diagnostic.presence['endpoint.internal_ws']).toBe(true);
    expect(diagnostic.presence['auth.proxy_data_token']).toBe(true);
    expect(diagnostic.presence['profile.provider']).toBe(true);
    expect(diagnostic.presence['profile.secret']).toBe(true);
    expect(diagnostic.public_endpoint).toBe(null);
    expect(serialized).not.toContain('172.18.0.1');
    expect(serialized).not.toContain('mbos-proxy-data-token-raw-value');
    expect(serialized).not.toContain('llm-proxy-data-token-raw-value');
    expect(serialized).not.toContain('sk-redaction-alias-raw-value');
    expect(findRedactionLeaks(diagnostic)).toEqual([]);
  });

  it('normalizes non-allowlisted additionalPresence labels so key names cannot leak secrets', () => {
    const diagnostic = buildRedactedFailureBundle({
      env: {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
      },
      additionalPresence: {
        'Authorization: Bearer additional-presence-raw-value': true,
        'managed_credentials.feishu=additional-managed-credential-raw-value': true,
        'probe.dns_gateway_reachable': false,
      },
    });

    const serialized = stringifyDiagnostic(diagnostic);

    expect(diagnostic.presence['probe.dns_gateway_reachable']).toBe(false);
    expect(diagnostic.presence['presence.unclassified']).toBe(true);
    expect(Object.keys(diagnostic.presence).some((key) => key.startsWith('presence_label_sha256_'))).toBe(false);
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('additional-presence-raw-value');
    expect(serialized).not.toContain('managed_credentials.feishu=');
    expect(serialized).not.toContain('additional-managed-credential-raw-value');
    expect(findRedactionLeaks(diagnostic)).toEqual([]);
  });

  it('redacts object-shaped secret assignments and detects residual object leaks', () => {
    const summary = [
      'managed_credentials: {"feishu":"redaction-managed-credential-object-raw-value"}',
      'password: {"value":"redaction-password-object-raw-value"}',
      '"client_secret": {"value":"redaction-client-secret-object-raw-value"}',
      'Authorization: Bearer redaction-bearer-object-raw-token',
    ].join(' ');

    expect(findRedactionLeaks(summary).length).toBeGreaterThan(0);
    expect(findRedactionLeaks('"feishu":"redaction-managed-credential-object-raw-value"}').length).toBeGreaterThan(0);
    expect(findRedactionLeaks('"value":"redaction-password-object-raw-value"}').length).toBeGreaterThan(0);

    const redacted = redactSensitiveText(summary);

    expect(redacted).toContain('[redacted]');
    expect(redacted).not.toContain('redaction-managed-credential-object-raw-value');
    expect(redacted).not.toContain('redaction-password-object-raw-value');
    expect(redacted).not.toContain('redaction-client-secret-object-raw-value');
    expect(redacted).not.toContain('redaction-bearer-object-raw-token');
    expect(redacted).not.toContain('"feishu"');
    expect(redacted).not.toContain('"value":"redaction-password-object-raw-value"');
    expect(findRedactionLeaks(redacted)).toEqual([]);
  });
});
