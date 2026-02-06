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
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { AgentAPI, getApiClient } from '@/lib/api';
import type { CreateAgentRequest } from '@/lib/api/endpoints/agents';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';

export interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
}

interface EnvEntry {
  key: string;
  value: string;
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
  const [mode, setMode] = React.useState<'external' | 'internal'>('external');
  const [interactionMode, setInteractionMode] = React.useState<'chat' | 'workbench' | 'both'>('both');
  const [image, setImage] = React.useState('');
  const [envEntries, setEnvEntries] = React.useState<EnvEntry[]>([{ key: '', value: '' }]);
  const [maxConcurrentSessions, setMaxConcurrentSessions] = React.useState<string>('');

  const agentAPI = React.useMemo(() => new AgentAPI(getApiClient()), []);

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
    setInteractionMode('both');
    setImage('');
    setEnvEntries([{ key: '', value: '' }]);
    setMaxConcurrentSessions('');
  };

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const data: CreateAgentRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      mode,
      interaction_mode: interactionMode,
    };

    if (mode === 'internal') {
      if (!image.trim()) {
        toast.error(t('create_dialog.image_required'));
        return;
      }
      const env: Record<string, string> = {};
      envEntries.forEach(({ key, value }) => {
        if (key.trim()) env[key.trim()] = value;
      });
      data.config = {
        image: image.trim(),
        env: Object.keys(env).length > 0 ? env : undefined,
        max_concurrent_sessions_override: maxConcurrentSessions.trim()
          ? parseInt(maxConcurrentSessions, 10)
          : undefined,
      };
    }

    createMutation.mutate(data);
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto" data-testid="agents__create-dialog">
        <DialogHeader>
          <DialogTitle>{t('create_dialog.title')}</DialogTitle>
          <DialogDescription>{t('create_dialog.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="agent-name" className="text-sm font-medium text-foreground">
              {t('create_dialog.name')}
            </label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create_dialog.name_placeholder')}
              disabled={createMutation.isPending}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="agent-description" className="text-sm font-medium text-foreground">
              {t('create_dialog.description')}
            </label>
            <textarea
              id="agent-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={commonT('placeholders.enter_description')}
              rows={2}
              disabled={createMutation.isPending}
              className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t('create_dialog.mode')}</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="external"
                  checked={mode === 'external'}
                  onChange={() => setMode('external')}
                  disabled={createMutation.isPending}
                  className="rounded-full border-subtle"
                />
                <span className="text-sm">{t('create_dialog.mode_external')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="internal"
                  checked={mode === 'internal'}
                  onChange={() => setMode('internal')}
                  disabled={createMutation.isPending}
                  className="rounded-full border-subtle"
                />
                <span className="text-sm">{t('create_dialog.mode_internal')}</span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t('create_dialog.interaction_mode')}</label>
            <select
              value={interactionMode}
              onChange={(e) => setInteractionMode(e.target.value as 'chat' | 'workbench' | 'both')}
              disabled={createMutation.isPending}
              className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="chat">{t('interaction_chat')}</option>
              <option value="workbench">{t('interaction_workbench')}</option>
              <option value="both">{t('interaction_both')}</option>
            </select>
          </div>

          {mode === 'internal' && (
            <div className="space-y-4 p-4 rounded-sm border border-subtle bg-surface-low">
              <h4 className="text-sm font-medium text-foreground">{t('create_dialog.config_title')}</h4>

              <div className="space-y-2">
                <label htmlFor="agent-image" className="text-sm text-primary">
                  {t('create_dialog.image')} <span className="text-error">*</span>
                </label>
                <Input
                  id="agent-image"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="e.g. my-agent:v1.0"
                  disabled={createMutation.isPending}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-primary">{t('create_dialog.env')}</label>
                <div className="space-y-2">
                  {envEntries.map((entry, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={entry.key}
                        onChange={(e) => updateEnvEntry(i, 'key', e.target.value)}
                        placeholder="KEY"
                        disabled={createMutation.isPending}
                        className="font-mono text-sm flex-1"
                      />
                      <Input
                        value={entry.value}
                        onChange={(e) => updateEnvEntry(i, 'value', e.target.value)}
                        placeholder="value"
                        disabled={createMutation.isPending}
                        className="font-mono text-sm flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeEnvEntry(i)}
                        disabled={createMutation.isPending || envEntries.length <= 1}
                        className="p-2 text-tertiary hover:text-error disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addEnvEntry}
                    disabled={createMutation.isPending}
                    className="flex items-center gap-1 text-sm text-accent hover:underline"
                  >
                    <Plus className="w-4 h-4" />
                    {t('create_dialog.add_env')}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="agent-max-sessions" className="text-sm text-primary">
                  {t('create_dialog.max_concurrent_sessions')}
                </label>
                <Input
                  id="agent-max-sessions"
                  type="number"
                  min={1}
                  value={maxConcurrentSessions}
                  onChange={(e) => setMaxConcurrentSessions(e.target.value)}
                  placeholder={t('create_dialog.max_concurrent_sessions_placeholder')}
                  disabled={createMutation.isPending}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={createMutation.isPending}
            >
              {commonT('cancel')}
            </Button>
            <Button type="submit" variant="action" disabled={!canSubmit}>
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                commonT('create')
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
