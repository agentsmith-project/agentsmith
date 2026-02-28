import { describe, expect, it } from 'vitest';
import {
  validateAliasTargetExists,
  validateComboTargetsExist,
  validateModelDeletionAllowed,
  validateModelProviderMutationAllowed,
} from './runtime-domain.js';
import type {
  RuntimeModelAliasRecord,
  RuntimeModelCatalogEntryRecord,
  RuntimeModelComboRecord,
} from './runtime-store.js';

const baseModel: RuntimeModelCatalogEntryRecord = {
  id: 'rmc_1',
  workspace_id: 'ws_default',
  project_id: 'proj_1',
  provider: 'openai',
  model_id: 'gpt-4o',
  capabilities: ['chat'],
  created_at: '2026-02-28T00:00:00.000Z',
  updated_at: '2026-02-28T00:00:00.000Z',
};

describe('runtime-domain', () => {
  it('validates alias targets against known models', () => {
    expect(validateAliasTargetExists({
      models: [baseModel],
      targetProvider: 'openai',
      targetModel: 'gpt-4o',
    })).toEqual({ ok: true });

    expect(validateAliasTargetExists({
      models: [baseModel],
      targetProvider: 'anthropic',
      targetModel: 'claude-sonnet-4-5',
    })).toEqual({ ok: false, message: 'runtime_alias_target_model_not_found' });
  });

  it('validates combo targets against known models', () => {
    expect(validateComboTargetsExist({
      models: [baseModel, { ...baseModel, id: 'rmc_2', provider: 'anthropic', model_id: 'claude-sonnet-4-5' }],
      targets: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      ],
    })).toEqual({ ok: true });

    expect(validateComboTargetsExist({
      models: [baseModel],
      targets: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      ],
    })).toEqual({ ok: false, message: 'runtime_combo_target_model_not_found' });
  });

  it('prevents deleting a model that is still referenced', () => {
    const alias: RuntimeModelAliasRecord = {
      id: 'rma_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      alias: 'assistant-main',
      target_provider: 'openai',
      target_model: 'gpt-4o',
      created_at: '2026-02-28T00:00:00.000Z',
      updated_at: '2026-02-28T00:00:00.000Z',
    };
    const combo: RuntimeModelComboRecord = {
      id: 'rmco_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'prod-chat',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
      fallback_policy: {
        max_hops: 1,
        retryable_error_classes: ['provider_retryable'],
      },
      created_at: '2026-02-28T00:00:00.000Z',
      updated_at: '2026-02-28T00:00:00.000Z',
    };

    expect(validateModelDeletionAllowed({
      model: baseModel,
      aliases: [alias],
      combos: [],
    })).toEqual({ ok: false, message: 'runtime_model_referenced_by_alias' });

    expect(validateModelDeletionAllowed({
      model: baseModel,
      aliases: [],
      combos: [combo],
    })).toEqual({ ok: false, message: 'runtime_model_referenced_by_combo' });

    expect(validateModelDeletionAllowed({
      model: baseModel,
      aliases: [],
      combos: [],
    })).toEqual({ ok: true });
  });

  it('prevents changing model provider while the model is still referenced', () => {
    const alias: RuntimeModelAliasRecord = {
      id: 'rma_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      alias: 'assistant-main',
      target_provider: 'openai',
      target_model: 'gpt-4o',
      created_at: '2026-02-28T00:00:00.000Z',
      updated_at: '2026-02-28T00:00:00.000Z',
    };
    const combo: RuntimeModelComboRecord = {
      id: 'rmco_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'prod-chat',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
      fallback_policy: {
        max_hops: 1,
        retryable_error_classes: ['provider_retryable'],
      },
      created_at: '2026-02-28T00:00:00.000Z',
      updated_at: '2026-02-28T00:00:00.000Z',
    };

    expect(validateModelProviderMutationAllowed({
      current: baseModel,
      nextProvider: 'anthropic',
      aliases: [alias],
      combos: [],
    })).toEqual({ ok: false, message: 'runtime_model_provider_change_blocked_by_alias' });

    expect(validateModelProviderMutationAllowed({
      current: baseModel,
      nextProvider: 'anthropic',
      aliases: [],
      combos: [combo],
    })).toEqual({ ok: false, message: 'runtime_model_provider_change_blocked_by_combo' });

    expect(validateModelProviderMutationAllowed({
      current: baseModel,
      nextProvider: 'openai',
      aliases: [alias],
      combos: [combo],
    })).toEqual({ ok: true });

    expect(validateModelProviderMutationAllowed({
      current: baseModel,
      nextProvider: 'anthropic',
      aliases: [],
      combos: [],
    })).toEqual({ ok: true });
  });
});
