import { describe, expect, it } from 'vitest';
import { migrateLegacyEndpointRecord } from './endpoint-migration.js';

describe('migrateLegacyEndpointRecord', () => {
  it('maps legacy openai-compatible records to chat-completions catalog endpoints', () => {
    const migrated = migrateLegacyEndpointRecord({
      id: 'ep_legacy_openai',
      project_id: 'proj_1',
      name: 'Legacy OpenAI',
      model: 'gpt-4.1',
      type: 'openai',
      protocol: 'openai_compatible',
      base_url: 'https://api.openai.com/v1',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    expect(migrated.type).toBe('catalog');
    expect(migrated.upstream_protocol).toBe('openai_chat_completions');
  });

  it('maps legacy anthropic-compatible records to anthropic-messages endpoints', () => {
    const migrated = migrateLegacyEndpointRecord({
      id: 'ep_legacy_anthropic',
      project_id: 'proj_1',
      name: 'Legacy Anthropic',
      model: 'claude-sonnet',
      type: 'anthropic',
      protocol: 'anthropic_compatible',
      base_url: 'https://api.anthropic.com/v1',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    expect(migrated.type).toBe('catalog');
    expect(migrated.upstream_protocol).toBe('anthropic_messages');
  });

  it('keeps explicit new-format custom records unchanged', () => {
    const migrated = migrateLegacyEndpointRecord({
      id: 'ep_new_custom',
      project_id: 'proj_1',
      name: 'Custom Responses',
      model: 'responses-model',
      type: 'custom',
      upstream_protocol: 'openai_responses',
      provider_family: 'custom',
      base_url: 'https://responses.provider.example/v1',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    expect(migrated.type).toBe('custom');
    expect(migrated.upstream_protocol).toBe('openai_responses');
    expect(migrated.provider_family).toBe('custom');
  });
});
