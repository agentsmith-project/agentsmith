import { describe, expect, it } from 'vitest';
import { resolveMockExternalConnectionsForRequest } from '../src/mocks/handlers/me';
import { seedMockExternalConnection } from '../src/mocks/state/me-external-connections';

function buildRequest(headers: Record<string, string>) {
  return new Request('http://localhost/api/v1/me/external-connections', {
    headers,
  });
}

describe('me handlers', () => {
  it('prefers stored external connections over visual seed headers when the store is populated', () => {
    const stored = [
      seedMockExternalConnection('user_001', {
        id: 'uec_stored',
        user_id: 'user_001',
        provider: 'jira',
        kind: 'secret_bundle',
        display_name: 'Stored Jira',
        status: 'active',
        fields: [],
      }),
    ];
    const request = buildRequest({
      authorization: 'Bearer mock_token_user_001_12345',
      'x-mock-connection-provider': 'custom',
      'x-mock-connection-kind': 'secret_bundle',
      'x-mock-connection-display-name': 'Visual Custom Integration',
      'x-mock-connection-fields': JSON.stringify([
        { key: 'base_url', value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
        { key: 'token', value: 'tok-visual-secret', description: 'API token', secret: true },
      ]),
    });

    const items = resolveMockExternalConnectionsForRequest({
      request,
      storedConnections: stored,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('uec_stored');
    expect(items[0]?.display_name).toBe('Stored Jira');
  });

  it('reads visual custom-domain seed data from the current request without referencing an undefined identifier', () => {
    const request = buildRequest({
      authorization: 'Bearer mock_token_user_001_12345',
      'x-mock-connection-provider': 'custom',
      'x-mock-connection-kind': 'secret_bundle',
      'x-mock-connection-display-name': 'Visual Custom Integration',
      'x-mock-connection-custom-domain': 'api.visual.example.com',
      'x-mock-connection-fields': JSON.stringify([
        { key: 'base_url', value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
      ]),
    });

    const items = resolveMockExternalConnectionsForRequest({
      request,
      storedConnections: [],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.custom_domain).toBe('api.visual.example.com');
  });
});
