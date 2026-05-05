'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentRunnerAPI, EndpointAPI, getApiClient } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';

interface EditableAgentRunner {
  id: string;
  name: string;
  description?: string;
  default_endpoint_id?: string;
  capabilities?: Record<string, unknown>;
}

export interface EditAgentRunnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  runner: EditableAgentRunner | null;
  onSuccess?: () => void;
}

interface UpdateAgentRunnerPayload {
  name?: string;
  description?: string;
  default_endpoint_id?: string;
  capabilities?: {
    terminal: boolean;
    artifacts: boolean;
    file_inputs: boolean;
  };
}

export function EditAgentRunnerDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  runner,
  onSuccess,
}: EditAgentRunnerDialogProps) {
  const t = useTranslations('agent_runners');
  const commonT = useTranslations('common');
  const { handleError } = useApiError();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [defaultEndpointId, setDefaultEndpointId] = React.useState('');
  const [terminalEnabled, setTerminalEnabled] = React.useState(true);
  const [artifactsEnabled, setArtifactsEnabled] = React.useState(true);
  const [fileInputsEnabled, setFileInputsEnabled] = React.useState(true);

  const runnerAPI = React.useMemo(() => new AgentRunnerAPI(getApiClient()), []);
  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);

  const { data: endpointsData } = useQuery({
    queryKey: ['agent-runners', workspaceId, projectId, 'endpoint-options'],
    queryFn: () => endpointAPI.list(workspaceId, projectId, { page: 1, page_size: 500 }),
    enabled: open && !!workspaceId && !!projectId,
  });
  const endpointOptions = React.useMemo(
    () => (endpointsData?.items ?? []).filter((item) => item.status === 'active'),
    [endpointsData?.items],
  );

  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateAgentRunnerPayload) => {
      if (!runner) throw new Error('No runner');
      return runnerAPI.update(workspaceId, projectId, runner.id, payload);
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
    if (!open || !runner) return;
    const capabilities = runner.capabilities ?? {};
    setName(runner.name);
    setDescription(runner.description ?? '');
    setDefaultEndpointId(runner.default_endpoint_id ?? '');
    setTerminalEnabled(capabilities.terminal !== false);
    setArtifactsEnabled(capabilities.artifacts !== false);
    setFileInputsEnabled(capabilities.file_inputs !== false);
  }, [open, runner]);

  React.useEffect(() => {
    if (endpointOptions.length === 0) return;
    if (!defaultEndpointId) return;
    if (endpointOptions.some((item) => item.id === defaultEndpointId)) return;
    setDefaultEndpointId(endpointOptions[0].id);
  }, [defaultEndpointId, endpointOptions]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!runner || !name.trim()) return;
    updateMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      default_endpoint_id: defaultEndpointId || undefined,
      capabilities: {
        terminal: terminalEnabled,
        artifacts: artifactsEnabled,
        file_inputs: fileInputsEnabled,
      },
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !updateMutation.isPending) onOpenChange(next);
  };

  if (!runner) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]" data-testid="agent-runners__edit-dialog">
        <DialogHeader>
          <DialogTitle>{t('edit_dialog.title')}</DialogTitle>
          <DialogDescription>{t('edit_dialog.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">{t('create_dialog.name')}</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} disabled={updateMutation.isPending} />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">{t('create_dialog.description_label')}</span>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} disabled={updateMutation.isPending} />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">{t('default_endpoint')}</span>
            <select
              className="h-10 w-full rounded-md border border-border-input/65 bg-input px-3 text-sm text-foreground"
              value={defaultEndpointId}
              onChange={(event) => setDefaultEndpointId(event.target.value)}
              disabled={updateMutation.isPending}
            >
              <option value="">{t('not_configured')}</option>
              {endpointOptions.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name} ({endpoint.provider_family}/{endpoint.model})
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">{t('capabilities')}</div>
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={terminalEnabled} onChange={(event) => setTerminalEnabled(event.target.checked)} />
              {t('capability_terminal')}
            </label>
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={artifactsEnabled} onChange={(event) => setArtifactsEnabled(event.target.checked)} />
              {t('capability_artifacts')}
            </label>
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={fileInputsEnabled} onChange={(event) => setFileInputsEnabled(event.target.checked)} />
              {t('capability_file_inputs')}
            </label>
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
            <Button type="submit" variant="primary" disabled={!name.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : commonT('save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
