import { describe, expect, it } from 'vitest';
import {
  buildEffectivePricingMap,
  comparePricingVersions,
  evaluatePricingActivationReadiness,
} from './runtime-pricing-governance.js';

describe('runtime-pricing-governance', () => {
  it('merges effective pricing by global then workspace then project precedence', () => {
    const effective = buildEffectivePricingMap({
      globalMap: {
        openai: {
          'gpt-4o': { input: 1, output: 5 },
        },
      },
      workspaceMap: {
        openai: {
          'gpt-4o': { input: 2, output: 6 },
        },
        anthropic: {
          'claude-sonnet-4-5': { input: 3, output: 12 },
        },
      },
      projectMap: {
        openai: {
          'gpt-4o': { input: 4, output: 8 },
        },
      },
    });

    expect(effective).toEqual({
      openai: {
        'gpt-4o': { input: 4, output: 8 },
      },
      anthropic: {
        'claude-sonnet-4-5': { input: 3, output: 12 },
      },
    });
  });

  it('blocks activation when effective pricing still leaves referenced targets uncovered', () => {
    const readiness = evaluatePricingActivationReadiness({
      scopeType: 'project',
      candidateMap: {
        openai: {
          'gpt-4o': { input: 2, output: 10 },
        },
      },
      activeWorkspaceMap: {
        anthropic: {
          'claude-sonnet-4-5': { input: 4, output: 16 },
        },
      },
      models: [
        {
          id: 'rmc_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          provider: 'openai',
          model_id: 'gpt-4o',
          capabilities: ['chat'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'rmc_2',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          provider: 'google',
          model_id: 'gemini-2.5-pro',
          capabilities: ['chat'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      aliases: [
        {
          id: 'rma_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          alias: 'assistant-main',
          target_provider: 'openai',
          target_model: 'gpt-4o',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      combos: [
        {
          id: 'rmco_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          name: 'prod-chat',
          targets: [
            { provider: 'openai', model: 'gpt-4o' },
            { provider: 'google', model: 'gemini-2.5-pro' },
          ],
          fallback_policy: {
            max_hops: 1,
            retryable_error_classes: ['provider_retryable'],
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });

    expect(readiness.release_readiness).toBe('blocked');
    expect(readiness.blockers).toEqual(['runtime_pricing_activation_missing_price']);
    expect(readiness.missing_targets).toEqual([
      { provider: 'google', model: 'gemini-2.5-pro' },
    ]);
  });

  it('compares pricing versions by added removed changed unchanged targets', () => {
    const compared = comparePricingVersions({
      baseline: {
        id: 'rpv_base',
        scope_type: 'project',
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        version_name: 'base',
        pricing_map: {
          openai: {
            'gpt-4o': { input: 2, output: 10 },
            'gpt-4.1': { input: 3, output: 12 },
          },
        },
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      candidate: {
        id: 'rpv_next',
        scope_type: 'project',
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        version_name: 'next',
        pricing_map: {
          openai: {
            'gpt-4o': { input: 2, output: 10 },
          },
          anthropic: {
            'claude-sonnet-4-5': { input: 4, output: 15 },
          },
        },
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    expect(compared.summary).toEqual({
      added: 1,
      removed: 1,
      changed: 0,
      unchanged: 1,
    });
  });
});
