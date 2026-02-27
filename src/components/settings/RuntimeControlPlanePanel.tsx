'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import {
  useCreateRuntimeAlias,
  useCreateRuntimeCombo,
  useCreateRuntimeModel,
  useCreateRuntimeProvider,
  usePatchRuntimePricing,
  useRuntimeAliases,
  useRuntimeCombos,
  useRuntimeModels,
  useRuntimePricing,
  useRuntimeProviders,
} from '@/lib/hooks/use-runtime';

type RuntimeControlPlanePanelProps = {
  workspaceId: string;
  projectId: string;
  disabled?: boolean;
};

const DEFAULT_COMBO_JSON = JSON.stringify(
  {
    name: 'prod-chat',
    targets: [{ provider: 'openai', model: 'gpt-4o' }],
    fallback_policy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
  },
  null,
  2,
);

const DEFAULT_PRICING_JSON = JSON.stringify(
  {
    openai: {
      'gpt-4o': {
        input: 2,
        output: 10,
      },
    },
  },
  null,
  2,
);

export function RuntimeControlPlanePanel({ workspaceId, projectId, disabled = false }: RuntimeControlPlanePanelProps) {
  const [provider, setProvider] = useState('openai');
  const [providerBaseUrl, setProviderBaseUrl] = useState('https://api.openai.com/v1');
  const [providerCredentialRef, setProviderCredentialRef] = useState('');
  const [modelProvider, setModelProvider] = useState('openai');
  const [modelId, setModelId] = useState('gpt-4o');
  const [modelCapabilities, setModelCapabilities] = useState('chat');
  const [alias, setAlias] = useState('assistant-main');
  const [aliasTargetProvider, setAliasTargetProvider] = useState('openai');
  const [aliasTargetModel, setAliasTargetModel] = useState('gpt-4o');
  const [comboJson, setComboJson] = useState(DEFAULT_COMBO_JSON);
  const [pricingJson, setPricingJson] = useState(DEFAULT_PRICING_JSON);

  const providersQuery = useRuntimeProviders(workspaceId, projectId);
  const modelsQuery = useRuntimeModels(workspaceId, projectId);
  const aliasesQuery = useRuntimeAliases(workspaceId, projectId);
  const combosQuery = useRuntimeCombos(workspaceId, projectId);
  const pricingQuery = useRuntimePricing(workspaceId, projectId);

  const createProvider = useCreateRuntimeProvider(workspaceId, projectId);
  const createModel = useCreateRuntimeModel(workspaceId, projectId);
  const createAlias = useCreateRuntimeAlias(workspaceId, projectId);
  const createCombo = useCreateRuntimeCombo(workspaceId, projectId);
  const patchPricing = usePatchRuntimePricing(workspaceId, projectId);

  const pricingPretty = useMemo(() => {
    if (!pricingQuery.data || Object.keys(pricingQuery.data).length === 0) return null;
    return JSON.stringify(pricingQuery.data, null, 2);
  }, [pricingQuery.data]);

  const handleCreateProvider = async () => {
    try {
      await createProvider.mutateAsync({
        provider,
        auth_mode: 'api_key',
        base_url: providerBaseUrl,
        credential_ref: providerCredentialRef || undefined,
      });
      toast.success('Provider created');
    } catch {
      toast.error('Failed to create provider');
    }
  };

  const handleCreateModel = async () => {
    try {
      await createModel.mutateAsync({
        provider: modelProvider,
        model_id: modelId,
        capabilities: modelCapabilities.split(',').map((v) => v.trim()).filter(Boolean),
      });
      toast.success('Model created');
    } catch {
      toast.error('Failed to create model');
    }
  };

  const handleCreateAlias = async () => {
    try {
      await createAlias.mutateAsync({
        alias,
        target_provider: aliasTargetProvider,
        target_model: aliasTargetModel,
      });
      toast.success('Alias created');
    } catch {
      toast.error('Failed to create alias');
    }
  };

  const handleCreateCombo = async () => {
    try {
      const payload = JSON.parse(comboJson) as {
        name: string;
        targets: Array<{ provider: string; model: string }>;
        fallback_policy: { max_hops: number; retryable_error_classes: string[] };
      };
      await createCombo.mutateAsync(payload);
      toast.success('Combo created');
    } catch {
      toast.error('Failed to create combo');
    }
  };

  const handleSavePricing = async () => {
    try {
      const payload = JSON.parse(pricingJson) as Record<string, Record<string, Record<string, number>>>;
      await patchPricing.mutateAsync(payload);
      toast.success('Pricing updated');
    } catch {
      toast.error('Failed to update pricing');
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface-high/70 p-4" data-testid="settings-runtime__panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Runtime Control Plane</h3>
          <p className="text-xs text-tertiary">Provider/model/routing/pricing operations for this project.</p>
        </div>
        <div className="text-xs text-tertiary" data-testid="settings-runtime__counts">
          P {providersQuery.data?.items.length ?? 0} · M {modelsQuery.data?.items.length ?? 0} · A {aliasesQuery.data?.items.length ?? 0} · C {combosQuery.data?.items.length ?? 0}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="text-xs font-medium text-primary">Create Provider</div>
          <Input value={provider} onChange={(e) => setProvider(e.target.value)} disabled={disabled} data-testid="settings-runtime__provider-name" />
          <Input value={providerBaseUrl} onChange={(e) => setProviderBaseUrl(e.target.value)} disabled={disabled} data-testid="settings-runtime__provider-base-url" />
          <Input value={providerCredentialRef} onChange={(e) => setProviderCredentialRef(e.target.value)} placeholder="credential_ref" disabled={disabled} data-testid="settings-runtime__provider-credential-ref" />
          <Button onClick={handleCreateProvider} disabled={disabled || createProvider.isPending} size="sm" data-testid="settings-runtime__provider-create">
            Create
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="text-xs font-medium text-primary">Create Model</div>
          <Input value={modelProvider} onChange={(e) => setModelProvider(e.target.value)} disabled={disabled} data-testid="settings-runtime__model-provider" />
          <Input value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={disabled} data-testid="settings-runtime__model-id" />
          <Input value={modelCapabilities} onChange={(e) => setModelCapabilities(e.target.value)} placeholder="chat,tools" disabled={disabled} data-testid="settings-runtime__model-capabilities" />
          <Button onClick={handleCreateModel} disabled={disabled || createModel.isPending} size="sm" data-testid="settings-runtime__model-create">
            Create
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="text-xs font-medium text-primary">Create Alias</div>
          <Input value={alias} onChange={(e) => setAlias(e.target.value)} disabled={disabled} data-testid="settings-runtime__alias-name" />
          <Input value={aliasTargetProvider} onChange={(e) => setAliasTargetProvider(e.target.value)} disabled={disabled} data-testid="settings-runtime__alias-target-provider" />
          <Input value={aliasTargetModel} onChange={(e) => setAliasTargetModel(e.target.value)} disabled={disabled} data-testid="settings-runtime__alias-target-model" />
          <Button onClick={handleCreateAlias} disabled={disabled || createAlias.isPending} size="sm" data-testid="settings-runtime__alias-create">
            Create
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="text-xs font-medium text-primary">Create Combo (JSON)</div>
          <Textarea value={comboJson} onChange={(e) => setComboJson(e.target.value)} className="font-mono text-xs" rows={6} disabled={disabled} data-testid="settings-runtime__combo-json" />
          <Button onClick={handleCreateCombo} disabled={disabled || createCombo.isPending} size="sm" data-testid="settings-runtime__combo-create">
            Create
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-primary">Pricing Overrides (JSON)</div>
          {pricingPretty ? <div className="text-[11px] text-tertiary">Loaded pricing map available</div> : null}
        </div>
        <Textarea value={pricingJson} onChange={(e) => setPricingJson(e.target.value)} className="font-mono text-xs" rows={7} disabled={disabled} data-testid="settings-runtime__pricing-json" />
        <Button onClick={handleSavePricing} disabled={disabled || patchPricing.isPending} size="sm" data-testid="settings-runtime__pricing-save">
          Save
        </Button>
      </div>
    </div>
  );
}
