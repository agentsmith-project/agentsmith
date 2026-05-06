'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
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
import { AgentRunnerAPI, getApiClient } from '@/lib/api';
import type { UpdateAgentRunnerRequest } from '@/lib/api/endpoints/agent-runners';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';

interface EditableAgentRunner {
  id: string;
  name: string;
  description?: string;
  read_only?: boolean;
}

export interface EditAgentRunnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  runner: EditableAgentRunner | null;
  onSuccess?: () => void;
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

  const runnerAPI = React.useMemo(() => new AgentRunnerAPI(getApiClient()), []);

  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateAgentRunnerRequest) => {
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
    setName(runner.name);
    setDescription(runner.description ?? '');
  }, [open, runner]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!runner || !name.trim()) return;
    updateMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !updateMutation.isPending) onOpenChange(next);
  };

  if (!runner || runner.read_only) return null;

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
