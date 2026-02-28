import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeControlPlanePanel } from '../RuntimeControlPlanePanel';

const createProviderMutateAsync = vi.fn().mockResolvedValue({});
const createModelMutateAsync = vi.fn().mockResolvedValue({});
const createAliasMutateAsync = vi.fn().mockResolvedValue({});
const createComboMutateAsync = vi.fn().mockResolvedValue({});
const patchPricingMutateAsync = vi.fn().mockResolvedValue({});
const dryRunMutateAsync = vi.fn().mockResolvedValue({
  model: 'combo:prod-chat',
  routed_by: 'combo',
  combo_name: 'prod-chat',
  attempts: [
    {
      index: 0,
      provider: 'openai',
      model: 'gpt-4o',
      provider_connection_id: 'rpc_1',
      provider_connection_status: 'active',
      pricing_source: 'project_override',
      pricing: { input: 2, output: 10 },
    },
  ],
  issues: [],
  guardrails: {
    release_readiness: 'ready',
    blockers: [],
    warnings: [],
  },
});
const impactMutateAsync = vi.fn().mockImplementation(async ({ model }: { model: string }) => ({
  model,
  lookback_window: {
    start: '2026-02-21T00:00:00.000Z',
    end: '2026-02-28T00:00:00.000Z',
    lookback_hours: 168,
  },
  sample: {
    request_count: 42,
    total_estimated_cost: 0.1812,
    avg_estimated_cost: model === 'openai/gpt-4o' ? 0.004314 : 0.005114,
    avg_tokens_in: 812.5,
    avg_tokens_out: 296.25,
    avg_tokens_total: 1108.75,
  },
  planned_route: {
    model,
    routed_by: model.startsWith('combo:') ? 'combo' : 'direct',
    combo_name: model.startsWith('combo:') ? 'prod-chat' : undefined,
    attempts: [],
    issues: [],
    guardrails: {
      release_readiness: model === 'openai/gpt-4o' ? 'ready' : 'blocked',
      blockers: model === 'openai/gpt-4o' ? [] : ['runtime_guardrail_primary_pricing_missing'],
      warnings: model === 'openai/gpt-4o' ? [] : ['runtime_guardrail_fallback_connection_unavailable'],
    },
  },
  projected_cost: {
    primary_avg_cost: model === 'openai/gpt-4o' ? 0.004587 : 0.005987,
    primary_total_cost: model === 'openai/gpt-4o' ? 0.192654 : 0.251454,
    range_avg_cost: model === 'openai/gpt-4o'
      ? { low: 0.004587, high: 0.006881 }
      : { low: 0.005987, high: 0.008881 },
    range_total_cost: model === 'openai/gpt-4o'
      ? { low: 0.192654, high: 0.28899 }
      : { low: 0.251454, high: 0.372999 },
  },
  assumptions: [
    'impact_preview_uses_recent_endpoint_usage_facts',
    'impact_preview_applies_average_token_mix_to_planned_pricing',
  ],
  guardrails: {
    release_readiness: model === 'openai/gpt-4o' ? 'ready' : 'blocked',
    blockers: model === 'openai/gpt-4o' ? [] : ['runtime_guardrail_primary_pricing_missing'],
    warnings: model === 'openai/gpt-4o' ? [] : ['runtime_guardrail_fallback_connection_unavailable'],
  },
}));
const probeMutateAsync = vi.fn().mockResolvedValue({
  ok: true,
  statusCode: 200,
  data: {
    id: 'chatcmpl_1',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: 'probe ok' } }],
    runtime: {
      provider: 'openai',
      resolved_model: 'gpt-4o',
      fallback_hops: 1,
      pricing_version: 'runtime-pricing-v1',
      attempts: [
        {
          index: 0,
          provider: 'openai',
          model: 'gpt-4o',
          outcome: 'fallback_upstream_error',
          reason: 'runtime_upstream_error_recovered',
        },
        {
          index: 1,
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          outcome: 'success',
          reason: 'runtime_upstream_ok',
        },
      ],
    },
  },
});

vi.mock('@/lib/hooks/use-runtime', () => ({
  useRuntimeProviders: () => ({ data: { items: [] } }),
  useRuntimeModels: () => ({ data: { items: [] } }),
  useRuntimeAliases: () => ({ data: { items: [] } }),
  useRuntimeCombos: () => ({ data: { items: [] } }),
  useRuntimePricing: () => ({ data: {} }),
  useCreateRuntimeProvider: () => ({ mutateAsync: createProviderMutateAsync, isPending: false }),
  useCreateRuntimeModel: () => ({ mutateAsync: createModelMutateAsync, isPending: false }),
  useCreateRuntimeAlias: () => ({ mutateAsync: createAliasMutateAsync, isPending: false }),
  useCreateRuntimeCombo: () => ({ mutateAsync: createComboMutateAsync, isPending: false }),
  usePatchRuntimePricing: () => ({ mutateAsync: patchPricingMutateAsync, isPending: false }),
  useRuntimeImpactPreview: () => ({ mutateAsync: impactMutateAsync, isPending: false }),
  useRuntimeRoutingDryRun: () => ({ mutateAsync: dryRunMutateAsync, isPending: false }),
  useRuntimeUnifiedChatProbe: () => ({ mutateAsync: probeMutateAsync, isPending: false }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('RuntimeControlPlanePanel', () => {
  it('creates provider with expected payload', async () => {
    const user = userEvent.setup();
    render(<RuntimeControlPlanePanel workspaceId="ws_1" projectId="proj_1" />);

    await user.clear(screen.getByTestId('settings-runtime__provider-name'));
    await user.type(screen.getByTestId('settings-runtime__provider-name'), 'openai');
    await user.clear(screen.getByTestId('settings-runtime__provider-base-url'));
    await user.type(screen.getByTestId('settings-runtime__provider-base-url'), 'https://api.openai.com/v1');
    await user.clear(screen.getByTestId('settings-runtime__provider-credential-ref'));
    await user.type(screen.getByTestId('settings-runtime__provider-credential-ref'), 'cred_1');
    await user.click(screen.getByTestId('settings-runtime__provider-create'));

    expect(createProviderMutateAsync).toHaveBeenCalledWith({
      provider: 'openai',
      auth_mode: 'api_key',
      base_url: 'https://api.openai.com/v1',
      credential_ref: 'cred_1',
    });
  });

  it('patches pricing map from JSON payload', async () => {
    const user = userEvent.setup();
    render(<RuntimeControlPlanePanel workspaceId="ws_1" projectId="proj_1" />);

    fireEvent.change(screen.getByTestId('settings-runtime__pricing-json'), {
      target: { value: '{"openai":{"gpt-4o":{"input":2,"output":10}}}' },
    });
    await user.click(screen.getByTestId('settings-runtime__pricing-save'));

    expect(patchPricingMutateAsync).toHaveBeenCalledWith({
      openai: {
        'gpt-4o': {
          input: 2,
          output: 10,
        },
      },
    });
  });

  it('runs runtime probe and renders fallback timeline', async () => {
    const user = userEvent.setup();
    render(<RuntimeControlPlanePanel workspaceId="ws_1" projectId="proj_1" />);

    await user.clear(screen.getByTestId('settings-runtime__probe-model'));
    await user.type(screen.getByTestId('settings-runtime__probe-model'), 'combo:prod-chat');
    await user.clear(screen.getByTestId('settings-runtime__probe-prompt'));
    await user.type(screen.getByTestId('settings-runtime__probe-prompt'), 'hello');
    await user.click(screen.getByTestId('settings-runtime__probe-run'));

    expect(probeMutateAsync).toHaveBeenCalledWith({
      model: 'combo:prod-chat',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(screen.getByTestId('settings-runtime__probe-summary')).toBeInTheDocument();
    expect(screen.getByTestId('settings-runtime__probe-response')).toHaveTextContent('probe ok');
    expect(screen.getByTestId('settings-runtime__probe-pricing-version')).toHaveTextContent('runtime-pricing-v1');
    expect(screen.getByTestId('settings-runtime__probe-attempt-0')).toBeInTheDocument();
    expect(screen.getByTestId('settings-runtime__probe-attempt-1')).toBeInTheDocument();
  });

  it('runs routing dry-run and renders planned attempts', async () => {
    const user = userEvent.setup();
    render(<RuntimeControlPlanePanel workspaceId="ws_1" projectId="proj_1" />);

    await user.clear(screen.getByTestId('settings-runtime__dry-run-model'));
    await user.type(screen.getByTestId('settings-runtime__dry-run-model'), 'combo:prod-chat');
    await user.click(screen.getByTestId('settings-runtime__dry-run-run'));

    expect(dryRunMutateAsync).toHaveBeenCalledWith({
      model: 'combo:prod-chat',
    });
    expect(screen.getByTestId('settings-runtime__dry-run-summary')).toBeInTheDocument();
    expect(screen.getByTestId('settings-runtime__dry-run-attempt-0')).toBeInTheDocument();
    expect(screen.getByTestId('settings-runtime__dry-run-guardrails')).toHaveTextContent('runtime_guardrails_status_ready');
  });

  it('runs impact preview and renders projected cost cards', async () => {
    const user = userEvent.setup();
    render(<RuntimeControlPlanePanel workspaceId="ws_1" projectId="proj_1" />);

    await user.click(screen.getByTestId('settings-runtime__impact-run'));

    expect(impactMutateAsync).toHaveBeenCalledWith({
      model: 'combo:prod-chat',
      lookback_hours: 168,
    });
    expect(screen.getByTestId('settings-runtime__impact-sample-count')).toHaveTextContent('42');
    expect(screen.getByTestId('settings-runtime__impact-assumptions')).toBeInTheDocument();
    expect(screen.getByTestId('settings-runtime__impact-guardrails')).toHaveTextContent('runtime_guardrails_status_blocked');
  });

  it('runs side-by-side compare and renders deltas', async () => {
    const user = userEvent.setup();
    render(<RuntimeControlPlanePanel workspaceId="ws_1" projectId="proj_1" />);

    await user.clear(screen.getByTestId('settings-runtime__compare-baseline'));
    await user.type(screen.getByTestId('settings-runtime__compare-baseline'), 'openai/gpt-4o');
    await user.clear(screen.getByTestId('settings-runtime__compare-candidate'));
    await user.type(screen.getByTestId('settings-runtime__compare-candidate'), 'combo:prod-chat');
    await user.click(screen.getByTestId('settings-runtime__compare-run'));

    expect(impactMutateAsync).toHaveBeenCalledWith({
      model: 'openai/gpt-4o',
      lookback_hours: 168,
    });
    expect(impactMutateAsync).toHaveBeenCalledWith({
      model: 'combo:prod-chat',
      lookback_hours: 168,
    });
    expect(screen.getByTestId('settings-runtime__compare-delta')).toHaveTextContent('+$0.001400');
    expect(screen.getByTestId('settings-runtime__compare-baseline-guardrails')).toHaveTextContent('runtime_guardrails_status_ready');
    expect(screen.getByTestId('settings-runtime__compare-candidate-guardrails')).toHaveTextContent('runtime_guardrails_status_blocked');
  });
});
