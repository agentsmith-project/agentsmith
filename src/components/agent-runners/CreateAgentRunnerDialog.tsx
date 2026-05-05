'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Bot, Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentRunnerAPI, EndpointAPI, getApiClient } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';

export interface CreateAgentRunnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
}

interface CreateAgentRunnerPayload {
  name: string;
  description?: string;
  default_endpoint_id?: string;
  capabilities?: {
    terminal: boolean;
    artifacts: boolean;
    file_inputs: boolean;
  };
}

export function CreateAgentRunnerDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: CreateAgentRunnerDialogProps) {
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

  const createMutation = useMutation({
    mutationFn: async (payload: CreateAgentRunnerPayload) => runnerAPI.create(workspaceId, projectId, payload),
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
    setDefaultEndpointId('');
    setTerminalEnabled(true);
    setArtifactsEnabled(true);
    setFileInputsEnabled(true);
  };

  React.useEffect(() => {
    if (open) resetForm();
  }, [open]);

  React.useEffect(() => {
    if (endpointOptions.length === 0) {
      if (endpointsData && defaultEndpointId) setDefaultEndpointId('');
      return;
    }
    if (endpointOptions.some((item) => item.id === defaultEndpointId)) return;
    setDefaultEndpointId(endpointOptions[0].id);
  }, [defaultEndpointId, endpointOptions, endpointsData]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({
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
    if (!next && !createMutation.isPending) onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex h-full flex-col gap-0 overflow-hidden p-0"
        data-testid="agent-runners__create-dialog"
      >
        <SheetHeader className="border-b border-subtle px-6 py-5">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Bot className="h-3.5 w-3.5" />
            {t('object_badge')}
          </div>
          <SheetTitle>{t('create_dialog.title')}</SheetTitle>
          <SheetDescription>{t('create_dialog.description')}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">{t('create_dialog.name')}</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('create_dialog.name_placeholder')}
                disabled={createMutation.isPending}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">{t('create_dialog.description_label')}</span>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('create_dialog.description_placeholder')}
                disabled={createMutation.isPending}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">{t('default_endpoint')}</span>
              <select
                className="h-10 w-full rounded-md border border-border-input/65 bg-input px-3 text-sm text-foreground"
                value={defaultEndpointId}
                onChange={(event) => setDefaultEndpointId(event.target.value)}
                disabled={createMutation.isPending}
              >
                {endpointOptions.length === 0 ? (
                  <option value="">{t('not_configured')}</option>
                ) : endpointOptions.map((endpoint) => (
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
            <Button type="submit" variant="primary" disabled={!name.trim() || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : commonT('create')}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
