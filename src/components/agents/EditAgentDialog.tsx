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
import { Loader2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AgentAPI, EndpointAPI, getApiClient } from '@/lib/api';
import type { UpdateAgentRequest } from '@/lib/api/endpoints/agents';
import type { Agent } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';
import {
  INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
} from '@mbos/contracts';
import { EditAgentBasicsSection } from './agent-dialogs/EditAgentBasicsSection';
import { EditExecutionPreferencesSection } from './agent-dialogs/EditExecutionPreferencesSection';
import { EditInternalAgentSection } from './agent-dialogs/EditInternalAgentSection';
import { ExternalAgentSection } from './agent-dialogs/ExternalAgentSection';
import type { AgentInteractionKind, EnvEntry } from './agent-dialogs/types';
import { buildUpdateAgentPayload, getEditAgentFormState } from './agent-dialogs/edit-agent-utils';

export interface EditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  agent: Agent | null;
  canSetVisibility?: boolean;
  onSuccess?: () => void;
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
  const [interactionKind, setInteractionKind] = React.useState<AgentInteractionKind>('chat');
  const [executionPrefsOpen, setExecutionPrefsOpen] = React.useState(false);
  const [executionPreferences, setExecutionPreferences] = React.useState({});
  const [externalMultimodal, setExternalMultimodal] = React.useState(false);
  const [externalAcceptedMimeTypes, setExternalAcceptedMimeTypes] = React.useState('');
  const [externalMaxFileCount, setExternalMaxFileCount] = React.useState('');
  const [externalMaxTotalBytes, setExternalMaxTotalBytes] = React.useState('');
  const [executionEndpointId, setExecutionEndpointId] = React.useState('');
  const [visibility, setVisibility] = React.useState<'private' | 'public'>('private');
  const [image, setImage] = React.useState('');
  const [cpuRequest, setCpuRequest] = React.useState('500m');
  const [cpuLimit, setCpuLimit] = React.useState('2');
  const [memoryRequest, setMemoryRequest] = React.useState('512Mi');
  const [memoryLimit, setMemoryLimit] = React.useState('4Gi');
  const [idleTimeoutSec, setIdleTimeoutSec] = React.useState(String(INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS));
  const [maxLifetimeSec, setMaxLifetimeSec] = React.useState(String(INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS));
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
  const selectedEndpoint = endpointOptions.find((item) => item.id === executionEndpointId) ?? null;

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
      const initialState = getEditAgentFormState(agent);
      setName(initialState.name);
      setDescription(initialState.description);
      setInteractionKind(initialState.interactionKind);
      setExecutionPreferences(initialState.executionPreferences);
      setExecutionEndpointId(initialState.executionEndpointId);
      setImage(initialState.image);
      setCpuRequest(initialState.cpuRequest);
      setCpuLimit(initialState.cpuLimit);
      setMemoryRequest(initialState.memoryRequest);
      setMemoryLimit(initialState.memoryLimit);
      setIdleTimeoutSec(initialState.idleTimeoutSec);
      setMaxLifetimeSec(initialState.maxLifetimeSec);
      setEnvEntries(initialState.envEntries);
      setExternalMultimodal(initialState.externalMultimodal);
      setExternalAcceptedMimeTypes(initialState.externalAcceptedMimeTypes);
      setExternalMaxFileCount(initialState.externalMaxFileCount);
      setExternalMaxTotalBytes(initialState.externalMaxTotalBytes);
      setVisibility(initialState.visibility);
    }
  }, [open, agent]);

  React.useEffect(() => {
    if (endpointOptions.length === 0) {
      if (endpointsData && executionEndpointId) {
        setExecutionEndpointId('');
      }
      return;
    }
    if (endpointOptions.some((item) => item.id === executionEndpointId)) return;
    setExecutionEndpointId(endpointOptions[0].id);
  }, [endpointsData, executionEndpointId, endpointOptions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent || !name.trim()) return;

    if (
      !executionEndpointId.trim()
    ) {
      toast.error(interactionKind === 'chat' ? t('create_dialog.chat_endpoint_required') : t('create_dialog.notebook_endpoint_required'));
      return;
    }
    if (agent.mode === 'internal' && !image.trim()) {
      toast.error(t('create_dialog.image_required'));
      return;
    }

    updateMutation.mutate(buildUpdateAgentPayload({
      agent,
      canSetVisibility,
      cpuLimit,
      cpuRequest,
      description,
      envEntries,
      executionPreferences,
      externalAcceptedMimeTypes,
      externalMaxFileCount,
      externalMaxTotalBytes,
      externalMultimodal,
      idleTimeoutSec,
      image,
      interactionKind,
      maxLifetimeSec,
      memoryLimit,
      memoryRequest,
      name,
      executionEndpointId,
      executionEndpointUpstreamProtocol: selectedEndpoint?.upstream_protocol ?? null,
      visibility,
    }));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !updateMutation.isPending) {
      onOpenChange(next);
    }
  };

  const canSubmit = name.trim().length > 0 && !updateMutation.isPending;
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
          <EditAgentBasicsSection
            agent={agent}
            canSetVisibility={canSetVisibility}
            commonT={commonT}
            description={description}
            endpointOptions={endpointOptions}
            interactionKind={interactionKind}
            name={name}
            executionEndpointId={executionEndpointId}
            pending={updateMutation.isPending}
            t={t}
            visibility={visibility}
            onDescriptionChange={setDescription}
            onInteractionKindChange={setInteractionKind}
            onNameChange={setName}
            onExecutionEndpointIdChange={setExecutionEndpointId}
            onVisibilityChange={setVisibility}
          />

          {agent.mode === 'external' && (
            <ExternalAgentSection
              createPending={updateMutation.isPending}
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
          )}

          {agent.mode === 'internal' && (
            <EditInternalAgentSection
              cpuLimit={cpuLimit}
              cpuRequest={cpuRequest}
              envEntries={envEntries}
              idleTimeoutSec={idleTimeoutSec}
              image={image}
              maxLifetimeSec={maxLifetimeSec}
              memoryLimit={memoryLimit}
              memoryRequest={memoryRequest}
              pending={updateMutation.isPending}
              t={t}
              onAddEnvEntry={addEnvEntry}
              onCpuLimitChange={setCpuLimit}
              onCpuRequestChange={setCpuRequest}
              onIdleTimeoutSecChange={setIdleTimeoutSec}
              onImageChange={setImage}
              onMaxLifetimeSecChange={setMaxLifetimeSec}
              onMemoryLimitChange={setMemoryLimit}
              onMemoryRequestChange={setMemoryRequest}
              onRemoveEnvEntry={removeEnvEntry}
              onUpdateEnvEntry={updateEnvEntry}
            />
          )}

          <EditExecutionPreferencesSection
            executionPreferences={executionPreferences}
            open={executionPrefsOpen}
            pending={updateMutation.isPending}
            onChange={setExecutionPreferences}
            onOpenChange={setExecutionPrefsOpen}
          />

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
