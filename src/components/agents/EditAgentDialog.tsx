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
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { AgentAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import type { UpdateAgentRequest } from '@/lib/api/endpoints/agents';
import type { Agent } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { RuntimePreferencesEditor, type RuntimePreferences } from '@/components/settings/RuntimePreferencesEditor';

export interface EditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  agent: Agent | null;
  onSuccess?: () => void;
}

export function EditAgentDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  agent,
  onSuccess,
}: EditAgentDialogProps) {
  const t = useTranslations('agents');
  const commonT = useTranslations('common');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [interactionMode, setInteractionMode] = React.useState<'chat' | 'workbench' | 'both'>('both');
  const [runtimePrefsOpen, setRuntimePrefsOpen] = React.useState(false);
  const [runtimePreferences, setRuntimePreferences] = React.useState<RuntimePreferences>({});

  const agentAPI = React.useMemo(() => new AgentAPI(getApiClient()), []);

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
      handleErrorForToast(error);
    },
  });

  React.useEffect(() => {
    if (open && agent) {
      setName(agent.name ?? '');
      setDescription(agent.description ?? '');
      setInteractionMode(agent.interaction_mode ?? 'both');
      setRuntimePreferences((agent.runtime_preferences_json as RuntimePreferences) ?? {});
    }
  }, [open, agent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent || !name.trim()) return;

    const data: UpdateAgentRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      interaction_mode: interactionMode,
      runtime_preferences:
        Object.keys(runtimePreferences).length > 0
          ? (runtimePreferences as Record<string, unknown>)
          : undefined,
    };

    updateMutation.mutate(data);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !updateMutation.isPending) {
      onOpenChange(next);
    }
  };

  const canSubmit = name.trim().length > 0 && !updateMutation.isPending;

  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
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
            <label className="text-sm font-medium text-foreground">{t('create_dialog.interaction_mode')}</label>
            <select
              value={interactionMode}
              onChange={(e) => setInteractionMode(e.target.value as 'chat' | 'workbench' | 'both')}
              disabled={updateMutation.isPending}
              className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="chat">{t('interaction_chat')}</option>
              <option value="workbench">{t('interaction_workbench')}</option>
              <option value="both">{t('interaction_both')}</option>
            </select>
          </div>

          <div className="border border-subtle rounded-sm">
            <button
              type="button"
              onClick={() => setRuntimePrefsOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-hover"
            >
              {runtimePrefsOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              Runtime Preferences
            </button>
            {runtimePrefsOpen && (
              <div className="p-4 border-t border-subtle">
                <RuntimePreferencesEditor
                  value={runtimePreferences}
                  onChange={setRuntimePreferences}
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
            <Button type="submit" variant="action" disabled={!canSubmit}>
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
