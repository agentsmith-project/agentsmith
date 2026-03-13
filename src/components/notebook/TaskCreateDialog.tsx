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
import { Loader2 } from 'lucide-react';
import { useCreateTask } from '@/lib/hooks/use-task';
import { useQuery } from '@tanstack/react-query';
import { AgentAPI, getApiClient } from '@/lib/api';
import type { CreateTaskRequest } from '@/lib/types/task';
import { AgentSelectField } from '@/components/notebook/task-create-dialog/AgentSelectField';
import { ImportantNotice } from '@/components/notebook/task-create-dialog/ImportantNotice';
export interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: (taskId: string) => void;
}

export function TaskCreateDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: TaskCreateDialogProps) {
  const t = useTranslations('notebook.task');
  const commonT = useTranslations('common');
  const [title, setTitle] = React.useState('');
  const [agentId, setAgentId] = React.useState<string>('');
  const createTask = useCreateTask();

  // Fetch available agents
  const agentAPI = new AgentAPI(getApiClient());
  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId],
    queryFn: () => agentAPI.list(workspaceId, projectId),
    enabled: open && !!workspaceId && !!projectId,
  });

  const agents = React.useMemo(
    () => (agentsData?.items || []).filter(
      (agent) => agent.status === 'enabled' && agent.interaction_mode !== 'chat',
    ),
    [agentsData?.items],
  );
  const isAgentSelectable = React.useCallback((agent: { mode: string; presence?: string }) => (
    agent.mode === 'internal' || agent.presence === 'online' || agent.presence === 'managed'
  ), []);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setTitle('');
      setAgentId('');
    }
  }, [open]);

  React.useEffect(() => {
    if (!agentId) return;
    if (!agents.some((agent) => agent.id === agentId)) {
      setAgentId('');
    }
  }, [agentId, agents]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !agentId) {
      return;
    }

    const data: CreateTaskRequest = {
      title: title.trim(),
      agent_id: agentId,
    };

    try {
      const task = await createTask.mutateAsync({
        workspaceId,
        projectId,
        data,
      });
      onOpenChange(false);
      if (onSuccess) {
        onSuccess(task.id);
      }
    } catch {
      // Error is handled by the hook
    }
  };

  const canSubmit = title.trim().length > 0 && agentId.length > 0 && !createTask.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('create')}</DialogTitle>
          <DialogDescription>
            {t('create')} {t('new')}. {t('agent_fixed_notice')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="task-title" className="text-sm font-medium text-foreground">
              {t('create_title')}
            </label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('create_title')}
              disabled={createTask.isPending}
              required
            />
          </div>

          <AgentSelectField
            t={t}
            commonT={commonT}
            value={agentId}
            disabled={createTask.isPending}
            loading={agentsLoading}
            agents={agents}
            isAgentSelectable={isAgentSelectable}
            onValueChange={setAgentId}
          />

          <ImportantNotice t={t} />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={createTask.isPending}
            >
              {commonT('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createTask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
