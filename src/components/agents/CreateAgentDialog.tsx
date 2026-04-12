'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Bot, Loader2, Sparkles } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AgentAPI, EndpointAPI, getApiClient } from '@/lib/api';
import type { CreateAgentRequest } from '@/lib/api/endpoints/agents';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';
import {
  INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
} from '@mbos/contracts';
import { AgentBasicsSection } from './agent-dialogs/AgentBasicsSection';
import { ExternalAgentSection } from './agent-dialogs/ExternalAgentSection';
import { InternalAgentSection } from './agent-dialogs/InternalAgentSection';
import type { AgentInteractionKind, AgentMode, EnvEntry } from './agent-dialogs/types';
import { buildCreateAgentPayload } from './agent-dialogs/utils';

export interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
}

export function CreateAgentDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: CreateAgentDialogProps) {
  const t = useTranslations('agents');
  const commonT = useTranslations('common');
  const { handleError } = useApiError();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [mode, setMode] = React.useState<AgentMode>('external');
  const [interactionKind, setInteractionKind] = React.useState<AgentInteractionKind>('chat');
  const [image, setImage] = React.useState('');
  const [envEntries, setEnvEntries] = React.useState<EnvEntry[]>([{ key: '', value: '' }]);
  const [maxConcurrentSessions, setMaxConcurrentSessions] = React.useState<string>('');
  const [externalMultimodal, setExternalMultimodal] = React.useState(false);
  const [externalAcceptedMimeTypes, setExternalAcceptedMimeTypes] = React.useState('image/png,image/jpeg,image/webp,text/plain,application/pdf');
  const [externalMaxFileCount, setExternalMaxFileCount] = React.useState('8');
  const [externalMaxTotalBytes, setExternalMaxTotalBytes] = React.useState(String(60 * 1024 * 1024));
  const [executionEndpointId, setExecutionEndpointId] = React.useState('');
  const [cpuRequest, setCpuRequest] = React.useState('500m');
  const [cpuLimit, setCpuLimit] = React.useState('2');
  const [memoryRequest, setMemoryRequest] = React.useState('512Mi');
  const [memoryLimit, setMemoryLimit] = React.useState('4Gi');
  const [idleTimeoutSec, setIdleTimeoutSec] = React.useState(String(INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS));
  const [maxLifetimeSec, setMaxLifetimeSec] = React.useState(String(INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS));
  const [step, setStep] = React.useState<'product' | 'deployment'>('product');

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

  const createMutation = useMutation({
    mutationFn: async (data: CreateAgentRequest) => {
      return agentAPI.create(workspaceId, projectId, data);
    },
    onSuccess: () => {
      onOpenChange(false);
      resetForm();
      toast.success(t('create_dialog.success'));
      onSuccess?.();
    },
    onError: (error) => {
      handleError(error, { context: t('create_dialog.title') });
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setMode('external');
    setInteractionKind('chat');
    setImage('');
    setEnvEntries([{ key: '', value: '' }]);
    setMaxConcurrentSessions('');
    setExternalMultimodal(false);
    setExternalAcceptedMimeTypes('image/png,image/jpeg,image/webp,text/plain,application/pdf');
    setExternalMaxFileCount('8');
    setExternalMaxTotalBytes(String(60 * 1024 * 1024));
    setExecutionEndpointId('');
    setCpuRequest('500m');
    setCpuLimit('2');
    setMemoryRequest('512Mi');
    setMemoryLimit('4Gi');
    setIdleTimeoutSec(String(INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS));
    setMaxLifetimeSec(String(INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS));
    setStep('product');
  };

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  React.useEffect(() => {
    if (executionEndpointId) return;
    if (endpointOptions.length === 0) return;
    setExecutionEndpointId(endpointOptions[0].id);
  }, [executionEndpointId, endpointOptions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (mode === 'internal') {
      if (!image.trim()) {
        toast.error(t('create_dialog.image_required'));
        return;
      }
      if (!executionEndpointId.trim()) {
        toast.error(interactionKind === 'chat' ? t('create_dialog.chat_endpoint_required') : t('create_dialog.notebook_endpoint_required'));
        return;
      }
    }

    if (mode === 'external' && !executionEndpointId.trim()) {
      toast.error(interactionKind === 'chat' ? t('create_dialog.chat_endpoint_required') : t('create_dialog.notebook_endpoint_required'));
      return;
    }

    createMutation.mutate(buildCreateAgentPayload({
      cpuLimit,
      cpuRequest,
      description,
      envEntries,
      externalAcceptedMimeTypes,
      externalMaxFileCount,
      externalMaxTotalBytes,
      externalMultimodal,
      idleTimeoutSec,
      image,
      interactionKind,
      maxConcurrentSessions,
      maxLifetimeSec,
      memoryLimit,
      memoryRequest,
      mode,
      name,
      executionEndpointId,
    }));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !createMutation.isPending) {
      onOpenChange(next);
    }
  };

  const addEnvEntry = () => setEnvEntries((prev) => [...prev, { key: '', value: '' }]);
  const removeEnvEntry = (i: number) =>
    setEnvEntries((prev) => prev.filter((_, idx) => idx !== i));
  const updateEnvEntry = (i: number, field: 'key' | 'value', val: string) =>
    setEnvEntries((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e))
    );

  const canSubmit = name.trim().length > 0 && !createMutation.isPending;
  const canContinueToDeployment = canSubmit && executionEndpointId.trim().length > 0;

  const handleAdvanceToDeployment = React.useCallback(() => {
    // Defer the step swap until after the current click finishes so the
    // footer CTA cannot accidentally turn into the submit action mid-click.
    window.requestAnimationFrame(() => {
      setStep('deployment');
    });
  }, []);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex h-full flex-col gap-0 overflow-hidden p-0"
        data-testid="agents__create-dialog"
      >
        <SheetHeader className="border-b border-subtle px-6 py-5">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Bot className="h-3.5 w-3.5" />
            Agent
          </div>
          <SheetTitle>{t('create_dialog.title')}</SheetTitle>
          <SheetDescription>{t('edit_dialog.description')}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="rounded-lg border border-subtle bg-[linear-gradient(180deg,rgba(124,160,255,0.08),rgba(124,160,255,0.02))] p-4">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{t('create_dialog.title')}</p>
                  <p className="text-sm leading-6 text-secondary">
                    {step === 'product'
                      ? t('product_step_description')
                      : t('deployment_step_description')}
                  </p>
                </div>
              </div>
            </div>

            {step === 'product' ? (
              <AgentBasicsSection
                commonT={commonT}
                createPending={createMutation.isPending}
                description={description}
                endpointOptions={endpointOptions}
                interactionKind={interactionKind}
                mode={mode}
                name={name}
                executionEndpointId={executionEndpointId}
                t={t}
                onDescriptionChange={setDescription}
                onInteractionKindChange={setInteractionKind}
                onModeChange={setMode}
                onNameChange={setName}
                onExecutionEndpointIdChange={setExecutionEndpointId}
              />
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-subtle bg-surface-low p-4" data-testid="agents__create-dialog__product-summary">
                  <div className="grid gap-3 md:grid-cols-2">
                    <SummaryField label={t('create_dialog.name')} value={name.trim()} />
                    <SummaryField label={t('agent_kind')} value={interactionKind === 'chat' ? t('interaction_chat') : t('interaction_notebook')} />
                    <SummaryField label={t('create_dialog.mode')} value={mode === 'internal' ? t('create_dialog.mode_internal') : t('create_dialog.mode_external')} />
                    <SummaryField
                      label={t('execution_target')}
                      value={endpointOptions.find((endpoint) => endpoint.id === executionEndpointId)?.name ?? executionEndpointId}
                    />
                  </div>
                </div>

                {mode === 'internal' ? (
                  <InternalAgentSection
                    cpuLimit={cpuLimit}
                    cpuRequest={cpuRequest}
                    createPending={createMutation.isPending}
                    envEntries={envEntries}
                    idleTimeoutSec={idleTimeoutSec}
                    image={image}
                    maxConcurrentSessions={maxConcurrentSessions}
                    maxLifetimeSec={maxLifetimeSec}
                    memoryLimit={memoryLimit}
                    memoryRequest={memoryRequest}
                    t={t}
                    onAddEnvEntry={addEnvEntry}
                    onCpuLimitChange={setCpuLimit}
                    onCpuRequestChange={setCpuRequest}
                    onIdleTimeoutSecChange={setIdleTimeoutSec}
                    onImageChange={setImage}
                    onMaxConcurrentSessionsChange={setMaxConcurrentSessions}
                    onMaxLifetimeSecChange={setMaxLifetimeSec}
                    onMemoryLimitChange={setMemoryLimit}
                    onMemoryRequestChange={setMemoryRequest}
                    onRemoveEnvEntry={removeEnvEntry}
                    onUpdateEnvEntry={updateEnvEntry}
                  />
                ) : null}

                {mode === 'external' ? (
                  <ExternalAgentSection
                    createPending={createMutation.isPending}
                    externalAcceptedMimeTypes={externalAcceptedMimeTypes}
                    externalMaxFileCount={externalMaxFileCount}
                    externalMaxTotalBytes={externalMaxTotalBytes}
                    externalMultimodal={externalMultimodal}
                    t={t}
                    onExternalAcceptedMimeTypesChange={setExternalAcceptedMimeTypes}
                    onExternalMaxFileCountChange={setExternalMaxFileCount}
                    onExternalMaxTotalBytesChange={setExternalMaxTotalBytes}
                    onExternalMultimodalChange={setExternalMultimodal}
                  />
                ) : null}
              </div>
            )}

          </div>

          <div className="flex flex-shrink-0 justify-end gap-2 border-t border-subtle px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={createMutation.isPending}
            >
              {commonT('cancel')}
            </Button>
            {step === 'deployment' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('product')}
                disabled={createMutation.isPending}
              >
                {t('back_to_product_setup')}
              </Button>
            ) : null}
            {step === 'product' ? (
              <Button
                type="button"
                variant="primary"
                disabled={!canContinueToDeployment}
                onClick={handleAdvanceToDeployment}
              >
                {commonT('next')}
              </Button>
            ) : (
              <Button type="submit" variant="primary" disabled={!canSubmit}>
                {createMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  commonT('create')
                )}
              </Button>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{label}</div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}
