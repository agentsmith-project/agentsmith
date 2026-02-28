import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeControlPlanePanel } from '../RuntimeControlPlanePanel';

const createProviderMutateAsync = vi.fn().mockResolvedValue({});
const createModelMutateAsync = vi.fn().mockResolvedValue({});
const createAliasMutateAsync = vi.fn().mockResolvedValue({});
const createComboMutateAsync = vi.fn().mockResolvedValue({});
const patchPricingMutateAsync = vi.fn().mockResolvedValue({});
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
    expect(screen.getByTestId('settings-runtime__probe-attempt-0')).toBeInTheDocument();
    expect(screen.getByTestId('settings-runtime__probe-attempt-1')).toBeInTheDocument();
  });
});
