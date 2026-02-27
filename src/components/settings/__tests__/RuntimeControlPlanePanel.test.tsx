import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeControlPlanePanel } from '../RuntimeControlPlanePanel';

const createProviderMutateAsync = vi.fn().mockResolvedValue({});
const createModelMutateAsync = vi.fn().mockResolvedValue({});
const createAliasMutateAsync = vi.fn().mockResolvedValue({});
const createComboMutateAsync = vi.fn().mockResolvedValue({});
const patchPricingMutateAsync = vi.fn().mockResolvedValue({});

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
});
