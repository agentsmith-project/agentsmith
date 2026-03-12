'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AgentAPI, EndpointAPI, getApiClient } from '@/lib/api';
import type { UpdateAgentRequest } from '@/lib/api/endpoints/agents';
import type { Agent, Endpoint } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { ExecutionPreferencesEditor, type ExecutionPreferences } from '@/components/settings/ExecutionPreferencesEditor';
import { useApiError } from '@/lib/hooks/use-api-error';

export interface EditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  agent: Agent | null;
  canSetVisibility?: boolean;
  onSuccess?: () => void;
}

interface EnvEntry {
  key: string;
  value: string;
}

export function EditAgentDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  agent,
  canSetVisibility = false,
  onSuccess,
}: EditAgentDialogProps) {
  const t = useTranslations('agents');
  const commonT = useTranslations('common');
  const { handleError } = useApiError();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [interactionMode, setInteractionMode] = React.useState<'chat' | 'notebook' | 'both'>('both');
  const [executionPrefsOpen, setExecutionPrefsOpen] = React.useState(false);
  const [executionPreferences, setExecutionPreferences] = React.useState<ExecutionPreferences>({});
  const [externalMultimodal, setExternalMultimodal] = React.useState(false);
  const [externalAcceptedMimeTypes, setExternalAcceptedMimeTypes] = React.useState('');
  const [externalMaxFileCount, setExternalMaxFileCount] = React.useState('');
  const [externalMaxTotalBytes, setExternalMaxTotalBytes] = React.useState('');
  const [notebookEndpointId, setNotebookEndpointId] = React.useState('');
  const [visibility, setVisibility] = React.useState<'private' | 'public'>('private');
  const [image, setImage] = React.useState('');
  const [cpuRequest, setCpuRequest] = React.useState('500m');
  const [cpuLimit, setCpuLimit] = React.useState('2');
  const [memoryRequest, setMemoryRequest] = React.useState('512Mi');
  const [memoryLimit, setMemoryLimit] = React.useState('4Gi');
  const [idleTimeoutSec, setIdleTimeoutSec] = React.useState('1800');
  const [maxLifetimeSec, setMaxLifetimeSec] = React.useState('86400');
  const [envEntries, setEnvEntries] = React.useState<EnvEntry[]>([{ key: '', value: '' }]);

  const agentAPI = React.useMemo(() => new AgentAPI(getApiClient()), []);
  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);
  const { data: endpointsData } = useQuery({
    queryKey: ['agents', workspaceId, projectId, 'endpoint-options'],
    queryFn: () => endpointAPI.list(workspaceId, projectId, { page: 1, page_size: 500 }),
    enabled: open && !!workspaceId && !!projectId,
  });
  const endpointOptions = React.useMemo(
    () => (endpointsData?.items ?? []).filter((item) => item.status === 'active'),
    [endpointsData?.items],
  );

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateAgentRequest) => {
      if (!agent) throw new Error('No agent');
      return agentAPI.update(workspaceId, projectId, agent.id, data);
    },
    onSuccess: () => {
      onOpenChange(false);
      toast.success(t('edit_dialog.success'));
      onSuccess?.();
    },
    onError: (error) => {
      handleError(error, { context: t('edit_dialog.title') });
    },
  });

  React.useEffect(() => {
    if (open && agent) {
      setName(agent.name ?? '');
      setDescription(agent.description ?? '');
      setInteractionMode(agent.interaction_mode ?? 'both');
      setExecutionPreferences((agent.execution_preferences_json as ExecutionPreferences) ?? {});
      const executionPrefs = (agent.execution_preferences_json as Record<string, unknown> | undefined) ?? {};
      const notebook = (executionPrefs.notebook as Record<string, unknown> | undefined) ?? {};
      setNotebookEndpointId(typeof notebook.endpoint_id === 'string' ? notebook.endpoint_id : '');
      const config = (agent.config as Record<string, unknown> | undefined) ?? {};
      setImage(typeof config.image === 'string' ? config.image : '');
      setCpuRequest(typeof config.cpu_request === 'string' ? config.cpu_request : '500m');
      setCpuLimit(typeof config.cpu_limit === 'string' ? config.cpu_limit : '2');
      setMemoryRequest(typeof config.memory_request === 'string' ? config.memory_request : '512Mi');
      setMemoryLimit(typeof config.memory_limit === 'string' ? config.memory_limit : '4Gi');
      setIdleTimeoutSec(typeof config.idle_timeout_sec === 'number' ? String(config.idle_timeout_sec) : '1800');
      setMaxLifetimeSec(typeof config.max_lifetime_sec === 'number' ? String(config.max_lifetime_sec) : '86400');
      const env = typeof config.env === 'object' && config.env !== null
        ? (config.env as Record<string, unknown>)
        : {};
      const nextEnvEntries = Object.entries(env)
        .filter(([key]) => key.trim().length > 0)
        .map(([key, value]) => ({ key, value: typeof value === 'string' ? value : String(value) }));
      setEnvEntries(nextEnvEntries.length > 0 ? nextEnvEntries : [{ key: '', value: '' }]);
      setExternalMultimodal(agent.capabilities?.multimodal_completion ?? false);
      setExternalAcceptedMimeTypes((agent.capabilities?.accepted_mime_types ?? []).join(','));
      setExternalMaxFileCount(
        typeof agent.capabilities?.max_file_count === 'number'
          ? String(agent.capabilities.max_file_count)
          : '',
      );
      setExternalMaxTotalBytes(
        typeof agent.capabilities?.max_total_bytes === 'number'
          ? String(agent.capabilities.max_total_bytes)
          : '',
      );
      setVisibility(agent.visibility === 'public' ? 'public' : 'private');
    }
  }, [open, agent]);

  React.useEffect(() => {
    if (notebookEndpointId) return;
    if (endpointOptions.length === 0) return;
    setNotebookEndpointId(endpointOptions[0].id);
  }, [notebookEndpointId, endpointOptions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent || !name.trim()) return;

    const data: UpdateAgentRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      interaction_mode: interactionMode,
      execution_preferences: (() => {
        const nextPreferences: Record<string, unknown> = {
          ...(executionPreferences as Record<string, unknown>),
        };
        if (interactionMode === 'notebook' || interactionMode === 'both' || agent.mode === 'internal') {
          if (!notebookEndpointId.trim()) {
            return undefined;
          }
          nextPreferences.notebook = {
            ...(typeof nextPreferences.notebook === 'object' && nextPreferences.notebook !== null
              ? (nextPreferences.notebook as Record<string, unknown>)
              : {}),
            endpoint_id: notebookEndpointId.trim(),
            executor: 'codex_cli',
            wire_api: 'chat',
            model: 'gpt-5-codex',
          };
        }
        return Object.keys(nextPreferences).length > 0 ? nextPreferences : undefined;
      })(),
      config: agent.mode === 'internal'
        ? {
          image: image.trim() || undefined,
          endpoint_id: notebookEndpointId.trim() || undefined,
          cpu_request: cpuRequest.trim() || undefined,
          cpu_limit: cpuLimit.trim() || undefined,
          memory_request: memoryRequest.trim() || undefined,
          memory_limit: memoryLimit.trim() || undefined,
          idle_timeout_sec: Number.isFinite(Number.parseInt(idleTimeoutSec, 10))
            ? Number.parseInt(idleTimeoutSec, 10)
            : undefined,
          max_lifetime_sec: Number.isFinite(Number.parseInt(maxLifetimeSec, 10))
            ? Number.parseInt(maxLifetimeSec, 10)
            : undefined,
          env: (() => {
            const env: Record<string, string> = {};
            for (const { key, value } of envEntries) {
              const trimmedKey = key.trim();
              if (!trimmedKey) continue;
              env[trimmedKey] = value;
            }
            return Object.keys(env).length > 0 ? env : undefined;
          })(),
        }
        : undefined,
      capabilities: agent.mode === 'external'
        ? {
          streaming_completion: true,
          multimodal_completion: externalMultimodal,
          accepted_mime_types: externalAcceptedMimeTypes
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          max_file_count: Number.isFinite(Number.parseInt(externalMaxFileCount, 10))
            ? Number.parseInt(externalMaxFileCount, 10)
            : undefined,
          max_total_bytes: Number.isFinite(Number.parseInt(externalMaxTotalBytes, 10))
            ? Number.parseInt(externalMaxTotalBytes, 10)
            : undefined,
        }
        : undefined,
      visibility: canSetVisibility ? visibility : undefined,
    };

    if (
      (interactionMode === 'notebook' || interactionMode === 'both' || agent.mode === 'internal')
      && !notebookEndpointId.trim()
    ) {
      toast.error(t('create_dialog.notebook_endpoint_required'));
      return;
    }
    if (agent.mode === 'internal' && !image.trim()) {
      toast.error(t('create_dialog.image_required'));
      return;
    }

    updateMutation.mutate(data);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !updateMutation.isPending) {
      onOpenChange(next);
    }
  };

  const canSubmit = name.trim().length > 0 && !updateMutation.isPending;
  const endpointLabel = (endpoint: Endpoint) => {
    const model = endpoint.model?.trim() || 'n/a';
    const family = endpoint.provider_family ?? 'custom';
    return `${endpoint.name} (${family}/${model})`;
  };
  const addEnvEntry = () => setEnvEntries((prev) => [...prev, { key: '', value: '' }]);
  const removeEnvEntry = (i: number) =>
    setEnvEntries((prev) => prev.filter((_, idx) => idx !== i));
  const updateEnvEntry = (i: number, field: 'key' | 'value', val: string) =>
    setEnvEntries((prev) =>
      prev.map((entry, idx) => (idx === i ? { ...entry, [field]: val } : entry))
    );

  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto" data-testid="agents__edit-dialog">
        <DialogHeader>
          <DialogTitle>{t('edit_dialog.title')}</DialogTitle>
          <DialogDescription>{t('edit_dialog.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="edit-agent-name" className="text-sm font-medium text-foreground">
              {t('create_dialog.name')}
            </label>
            <Input
              id="edit-agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create_dialog.name_placeholder')}
              disabled={updateMutation.isPending}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-agent-description" className="text-sm font-medium text-foreground">
              {t('create_dialog.description')}
            </label>
            <textarea
              id="edit-agent-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={commonT('placeholders.enter_description')}
              rows={2}
              disabled={updateMutation.isPending}
              className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t('create_dialog.mode')}</label>
            <div className="px-3 py-2 rounded-sm border border-subtle bg-surface-low text-primary text-sm capitalize">
              {agent.mode}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{commonT('visibility')}</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}
              disabled={updateMutation.isPending || !canSetVisibility}
              className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-70"
            >
              <option value="private">{commonT('private')}</option>
              <option value="public">{commonT('public')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t('create_dialog.interaction_mode')}</label>
            <select
              value={interactionMode}
              onChange={(e) => setInteractionMode(e.target.value as 'chat' | 'notebook' | 'both')}
              disabled={updateMutation.isPending}
              className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="chat">{t('interaction_chat')}</option>
              <option value="notebook">{t('interaction_notebook')}</option>
              <option value="both">{t('interaction_both')}</option>
            </select>
          </div>

          {agent.mode === 'external' && (interactionMode === 'notebook' || interactionMode === 'both') && (
            <div className="space-y-2">
              <label htmlFor="edit-notebook-endpoint-id" className="text-sm font-medium text-foreground">
                {t('create_dialog.notebook_endpoint_id')}
              </label>
              <select
                id="edit-notebook-endpoint-id"
                value={notebookEndpointId}
                onChange={(event) => setNotebookEndpointId(event.target.value)}
                disabled={updateMutation.isPending}
                className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                {endpointOptions.length === 0 ? (
                  <option value="">{t('create_dialog.notebook_endpoint_empty')}</option>
                ) : null}
                {endpointOptions.map((endpoint) => (
                  <option key={endpoint.id} value={endpoint.id}>
                    {endpointLabel(endpoint)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {agent.mode === 'external' && (
            <div className="space-y-4 p-4 rounded-sm border border-subtle bg-surface-low">
              <h4 className="text-sm font-medium text-foreground">{t('create_dialog.capabilities_title')}</h4>
              <label className="flex items-center gap-2 text-sm text-primary">
                <input
                  type="checkbox"
                  checked={externalMultimodal}
                  onChange={(event) => setExternalMultimodal(event.target.checked)}
                  disabled={updateMutation.isPending}
                />
                {t('create_dialog.multimodal_enabled')}
              </label>
              <div className="space-y-2">
                <label className="text-sm text-primary">{t('create_dialog.accepted_mime_types')}</label>
                <Input
                  value={externalAcceptedMimeTypes}
                  onChange={(event) => setExternalAcceptedMimeTypes(event.target.value)}
                  placeholder="image/png,image/jpeg"
                  disabled={updateMutation.isPending}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm text-primary">{t('create_dialog.max_file_count')}</label>
                  <Input
                    type="number"
                    min={1}
                    value={externalMaxFileCount}
                    onChange={(event) => setExternalMaxFileCount(event.target.value)}
                    disabled={updateMutation.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-primary">{t('create_dialog.max_total_bytes')}</label>
                  <Input
                    type="number"
                    min={1024}
                    value={externalMaxTotalBytes}
                    onChange={(event) => setExternalMaxTotalBytes(event.target.value)}
                    disabled={updateMutation.isPending}
                  />
                </div>
              </div>
            </div>
          )}

          {agent.mode === 'internal' && (
            <div className="space-y-4 p-4 rounded-sm border border-subtle bg-surface-low">
              <h4 className="text-sm font-medium text-foreground">{t('create_dialog.config_title')}</h4>
              <div className="space-y-2">
                <label className="text-sm text-primary">{t('create_dialog.image')}</label>
                <Input value={image} onChange={(event) => setImage(event.target.value)} disabled={updateMutation.isPending} />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-primary">{t('create_dialog.notebook_endpoint_id')}</label>
                <select
                  value={notebookEndpointId}
                  onChange={(event) => setNotebookEndpointId(event.target.value)}
                  disabled={updateMutation.isPending}
                  className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  {endpointOptions.length === 0 ? (
                    <option value="">{t('create_dialog.notebook_endpoint_empty')}</option>
                  ) : null}
                  {endpointOptions.map((endpoint) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {endpointLabel(endpoint)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-primary">{t('create_dialog.env')}</label>
                <div className="space-y-2">
                  {envEntries.map((entry, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={entry.key}
                        onChange={(event) => updateEnvEntry(index, 'key', event.target.value)}
                        placeholder="KEY"
                        disabled={updateMutation.isPending}
                        className="font-mono text-sm flex-1"
                      />
                      <Input
                        value={entry.value}
                        onChange={(event) => updateEnvEntry(index, 'value', event.target.value)}
                        placeholder="value"
                        disabled={updateMutation.isPending}
                        className="font-mono text-sm flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeEnvEntry(index)}
                        disabled={updateMutation.isPending || envEntries.length <= 1}
                        className="p-2 text-tertiary hover:text-error disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addEnvEntry}
                    disabled={updateMutation.isPending}
                    className="flex items-center gap-1 text-sm text-accent hover:underline"
                  >
                    <Plus className="w-4 h-4" />
                    {t('create_dialog.add_env')}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm text-primary">{t('create_dialog.cpu_request')}</label>
                  <Input value={cpuRequest} onChange={(event) => setCpuRequest(event.target.value)} disabled={updateMutation.isPending} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-primary">{t('create_dialog.cpu_limit')}</label>
                  <Input value={cpuLimit} onChange={(event) => setCpuLimit(event.target.value)} disabled={updateMutation.isPending} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-primary">{t('create_dialog.memory_request')}</label>
                  <Input value={memoryRequest} onChange={(event) => setMemoryRequest(event.target.value)} disabled={updateMutation.isPending} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-primary">{t('create_dialog.memory_limit')}</label>
                  <Input value={memoryLimit} onChange={(event) => setMemoryLimit(event.target.value)} disabled={updateMutation.isPending} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-primary">{t('create_dialog.idle_timeout_sec')}</label>
                  <Input type="number" min={60} value={idleTimeoutSec} onChange={(event) => setIdleTimeoutSec(event.target.value)} disabled={updateMutation.isPending} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-primary">{t('create_dialog.max_lifetime_sec')}</label>
                  <Input type="number" min={600} value={maxLifetimeSec} onChange={(event) => setMaxLifetimeSec(event.target.value)} disabled={updateMutation.isPending} />
                </div>
              </div>
            </div>
          )}

          <div className="border border-subtle rounded-sm">
            <button
              type="button"
              onClick={() => setExecutionPrefsOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-hover"
            >
              {executionPrefsOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              Execution Preferences
            </button>
            {executionPrefsOpen && (
              <div className="p-4 border-t border-subtle">
                <ExecutionPreferencesEditor
                  value={executionPreferences}
                  onChange={setExecutionPreferences}
                  disabled={updateMutation.isPending}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={updateMutation.isPending}
            >
              {commonT('cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {updateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                commonT('save')
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
