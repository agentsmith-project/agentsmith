import { describe, expect, it } from 'vitest';
import {
  clearMockExternalConnections,
  createMockExternalConnection,
  listMockExternalConnections,
  seedMockExternalConnection,
  seedMockExternalConnections,
  updateMockExternalConnection,
} from '../me-external-connections';

describe('me-external-connections state helpers', () => {
  it('seeds one external connection at a time with cloned fields', () => {
    const seeded = seedMockExternalConnection('user_seed_1', {
      id: 'uec_seed_1',
      user_id: 'user_seed_1',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Visual Seed',
      status: 'active',
      fields: [
        { key: 'base_url', masked_value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
      ],
    });

    expect(seeded.id).toBe('uec_seed_1');
    expect(listMockExternalConnections('user_seed_1')).toEqual([seeded]);
  });

  it('seeds multiple external connections for the same user', () => {
    const seeded = seedMockExternalConnections('user_seed_2', [
      {
        id: 'uec_seed_2',
        user_id: 'user_seed_2',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Custom Seed A',
        status: 'active',
        fields: [],
      },
      {
        id: 'uec_seed_3',
        user_id: 'user_seed_2',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Custom Seed',
        status: 'active',
        fields: [],
      },
    ]);

    expect(seeded.map((item) => item.id)).toEqual(['uec_seed_2', 'uec_seed_3']);
    expect(listMockExternalConnections('user_seed_2')).toHaveLength(2);
  });

  it('preserves existing fields when updating a seeded connection', () => {
    seedMockExternalConnection('user_seed_3', {
      id: 'uec_seed_4',
      user_id: 'user_seed_3',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Visual Seed',
      status: 'active',
      fields: [
        { key: 'base_url', masked_value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
        { key: 'token', masked_value: '••••••••', description: 'API token', secret: true },
      ],
    });

    const updated = updateMockExternalConnection('user_seed_3', 'uec_seed_4', {
      display_name: 'Visual Seed Updated',
      fields: [
        { key: 'base_url', value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
        { key: 'token', value: 'tok-visual', description: 'API token', secret: true },
      ],
    });

    expect(updated?.display_name).toBe('Visual Seed Updated');
    expect(updated?.fields).toEqual([
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

  it('can clear stored external connections before a new visual seed is applied', () => {
    seedMockExternalConnection('user_seed_4', {
      id: 'uec_seed_5',
      user_id: 'user_seed_4',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Stored Custom Bundle',
      status: 'active',
      fields: [],
    });

    expect(listMockExternalConnections('user_seed_4')).toHaveLength(1);
    clearMockExternalConnections('user_seed_4');
    expect(listMockExternalConnections('user_seed_4')).toHaveLength(0);
  });

  it('preserves non-secret field values when creating a request-shaped connection', () => {
    const created = createMockExternalConnection('user_seed_5', {
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Created Visual Seed',
      fields: [
        { key: 'base_url', value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
        { key: 'token', value: 'tok-visual', description: 'API token', secret: true },
      ],
    });

    expect(created.fields).toEqual([
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

  it('preserves existing secret placeholders when an edit keeps the secret field blank', () => {
    seedMockExternalConnection('user_seed_6', {
      id: 'uec_seed_6',
      user_id: 'user_seed_6',
      provider: 'custom',
      kind: 'secret_bundle',
      display_name: 'Preserve Secret',
      status: 'active',
      fields: [
        { key: 'token', masked_value: '••••••••', description: 'API token', secret: true },
      ],
    });

    const updated = updateMockExternalConnection('user_seed_6', 'uec_seed_6', {
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
