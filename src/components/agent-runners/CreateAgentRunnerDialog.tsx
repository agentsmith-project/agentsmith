'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
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
import { AgentRunnerAPI, getApiClient } from '@/lib/api';
import type { CreateAgentRunnerRequest } from '@/lib/api/endpoints/agent-runners';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';

export interface CreateAgentRunnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
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

  const runnerAPI = React.useMemo(() => new AgentRunnerAPI(getApiClient()), []);

  const createMutation = useMutation({
    mutationFn: async (payload: CreateAgentRunnerRequest) => runnerAPI.create(workspaceId, projectId, payload),
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
  };

  React.useEffect(() => {
    if (open) resetForm();
  }, [open]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
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
