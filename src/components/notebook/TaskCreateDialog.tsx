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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useCreateTask } from '@/lib/hooks/use-task';
import { useQuery } from '@tanstack/react-query';
import { AgentAPI, getApiClient } from '@/lib/api';
import type { CreateTaskRequest } from '@/lib/types/task';
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

          <div className="space-y-2">
            <label htmlFor="task-agent" className="text-sm font-medium text-foreground">
              {t('select_agent')}
            </label>
            <Select value={agentId} onValueChange={setAgentId} disabled={createTask.isPending}>
              <SelectTrigger id="task-agent">
                <SelectValue placeholder={t('select_agent')} />
              </SelectTrigger>
              <SelectContent>
                {agentsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-tertiary" />
                  </div>
                ) : agents.length === 0 ? (
                  <div className="py-4 text-center text-sm text-tertiary">{commonT('empty')}</div>
                ) : (
                  agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md bg-surface-high border border-subtle p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
            <div className="text-xs text-tertiary space-y-1">
              <p className="font-medium text-foreground">{t('important')}</p>
              <p>• {t('agent_fixed_notice')}</p>
              <p>• {t('history_immutable_notice')}</p>
            </div>
          </div>

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
