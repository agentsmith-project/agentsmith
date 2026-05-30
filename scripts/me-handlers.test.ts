import { describe, expect, it } from 'vitest';
import {
  normalizeMockExternalConnectionSeed,
  resolveMockExternalConnectionsForRequest,
} from '../src/mocks/handlers/me';
import {
  buildMockExternalConnectionId,
  createMockExternalConnection,
  listMockExternalConnections,
  seedMockExternalConnection,
  seedMockExternalConnections,
  updateMockExternalConnection,
} from '../src/mocks/state/me-external-connections';

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
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Stored Custom Bundle',
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
    expect(items[0]?.display_name).toBe('Stored Custom Bundle');
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

  it('filters stored legacy external connection provider and kind records before UI-facing mock lists', () => {
    seedMockExternalConnection('user_007', {
      provider: 'sample_provider',
      kind: 'secret_bundle',
      display_name: 'Legacy Provider Bundle',
      fields: [],
    } as never);
    seedMockExternalConnection('user_007', {
      provider: 'custom',
      kind: 'oauth_account',
      display_name: 'Legacy Kind Account',
      fields: [],
    } as never);
    seedMockExternalConnection('user_007', {
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Supported Custom Bundle',
      fields: [],
    });
    const request = buildRequest({
      authorization: 'Bearer mock_token_user_007_12345',
    });

    const items = resolveMockExternalConnectionsForRequest({
      request,
      storedConnections: listMockExternalConnections('user_007'),
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.display_name).toBe('Supported Custom Bundle');
  });

  it('ignores visual seed headers for legacy external connection kinds', () => {
    const request = buildRequest({
      authorization: 'Bearer mock_token_user_008_12345',
      'x-mock-connection-provider': 'custom',
      'x-mock-connection-kind': 'oauth_account',
      'x-mock-connection-display-name': 'Legacy Visual Account',
      'x-mock-connection-fields': JSON.stringify([
        { key: 'token', value: 'legacy-token', description: 'Token', secret: true },
      ]),
    });

    const items = resolveMockExternalConnectionsForRequest({
      request,
      storedConnections: [],
    });

    expect(items).toEqual([]);
  });

  it('keeps non-secret field values and secret placeholders stable when seeding from request-shaped fields', () => {
    const seeded = seedMockExternalConnection('user_003', {
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Visual Custom Integration',
      fields: [
        { key: 'base_url', value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
        { key: 'token', value: 'tok-visual-secret', description: 'API token', secret: true },
      ],
    });

    expect(seeded.id).toBe(buildMockExternalConnectionId('Visual Custom Integration', 'custom'));
    expect(listMockExternalConnections('user_003')[0]?.fields).toEqual([
      {
        key: 'base_url',
        description: 'Base URL',
        secret: false,
        masked_value: 'https://api.visual.example.com',
      },
      {
        key: 'token',
        description: 'API token',
        secret: true,
        masked_value: '••••••••',
      },
    ]);
  });

  it('keeps create and seed semantics separate: create is uniquely identified while seed is stable', () => {
    const created = createMockExternalConnection('user_004', {
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Created Visual Custom',
      fields: [
        { key: 'base_url', value: 'https://api.created.example.com', description: 'Base URL', secret: false },
      ],
    } as never);
    const seeded = seedMockExternalConnections('user_004', [
      {
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Created Visual Custom',
        fields: [
          { key: 'base_url', value: 'https://api.created.example.com', description: 'Base URL', secret: false },
        ],
      },
    ])[0];

    expect(created.id).toMatch(/^uec_/);
    expect(created.id).not.toBe(buildMockExternalConnectionId('Created Visual Custom', 'custom'));
    expect(created.fields[0]?.masked_value).toBe('https://api.created.example.com');
    expect(seeded?.id).toBe(buildMockExternalConnectionId('Created Visual Custom', 'custom'));
    expect(seeded?.fields[0]?.masked_value).toBe('https://api.created.example.com');
  });

  it('preserves provided stable ids when the test seed contract supplies them', () => {
    const seeded = seedMockExternalConnections('user_005', [
      {
        id: 'uec_seeded_contract',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Seed Contract',
        fields: [
          { key: 'base_url', value: 'https://api.seed.example.com', description: 'Base URL', secret: false },
        ],
      },
    ]);

    expect(seeded[0]?.id).toBe('uec_seeded_contract');
    expect(seeded[0]?.fields[0]?.masked_value).toBe('https://api.seed.example.com');
  });

  it('preserves explicit seed metadata when normalizing the HTTP seed payload', () => {
    const normalized = normalizeMockExternalConnectionSeed('user_seed_http', {
      id: 'uec_seeded_http_contract',
      user_id: 'user_should_not_override_bucket',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Seed Contract HTTP',
      workspace_id: 'ws_visual',
      created_at: '2026-03-19T08:00:00.000Z',
      updated_at: '2026-03-19T09:00:00.000Z',
      last_refreshed_at: '2026-03-19T10:00:00.000Z',
      last_used_at: '2026-03-19T11:00:00.000Z',
      fields: [
        { key: 'base_url', value: 'https://api.seed.example.com', description: 'Base URL', secret: false },
      ],
    });

    expect(normalized).toMatchObject({
      id: 'uec_seeded_http_contract',
      user_id: 'user_seed_http',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Seed Contract HTTP',
      workspace_id: 'ws_visual',
      created_at: '2026-03-19T08:00:00.000Z',
      updated_at: '2026-03-19T09:00:00.000Z',
      last_refreshed_at: '2026-03-19T10:00:00.000Z',
      last_used_at: '2026-03-19T11:00:00.000Z',
    });
    expect(normalized.fields[0]).toEqual({
      key: 'base_url',
      description: 'Base URL',
      secret: false,
      masked_value: 'https://api.seed.example.com',
    });
  });

  it('preserves existing secret placeholders when a mock edit keeps the secret field blank', () => {
    seedMockExternalConnection('user_006', {
      id: 'uec_seeded_secret',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Seed Secret',
      fields: [
        { key: 'token', masked_value: '••••••••', description: 'API token', secret: true },
      ],
    });

    const updated = updateMockExternalConnection('user_006', 'uec_seeded_secret', {
      fields: [
        { key: 'token', value: '', description: 'API token', secret: true },
      ],
    });

    expect(updated?.fields).toEqual([
      {
        key: 'token',
        description: 'API token',
        secret: true,
        masked_value: '••••••••',
      },
    ]);
  });
});
