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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, FolderPlus, ShieldCheck } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { ProjectAPI, getApiClient } from '@/lib/api';
import type { CreateProjectRequest } from '@/lib/api/endpoints/projects';
import { handleErrorForToast } from '@/lib/api';

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onSuccess?: (projectId: string) => void;
  onCancel?: () => void;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  workspaceId,
  onSuccess,
  onCancel,
}: CreateProjectDialogProps) {
  const t = useTranslations('project');
  const commonT = useTranslations('common');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [visibility, setVisibility] = React.useState<'public' | 'private'>('private');
  const [joinPolicy, setJoinPolicy] = React.useState<'approval_required' | 'open'>('approval_required');

  const projectAPI = React.useMemo(() => new ProjectAPI(getApiClient()), []);

  const createMutation = useMutation({
    mutationFn: async (data: CreateProjectRequest) => {
      return projectAPI.create(workspaceId, data);
    },
    onSuccess: (apiProject) => {
      onOpenChange(false);
      resetForm();
      onSuccess?.(apiProject.id);
    },
    onError: (error) => {
      handleErrorForToast(error);
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setVisibility('private');
    setJoinPolicy('approval_required');
  };

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const data: CreateProjectRequest = {
      workspace_id: workspaceId,
      name: name.trim(),
      description: description.trim() || undefined,
      visibility,
      join_policy: joinPolicy,
    };

    createMutation.mutate(data);
  };

  const handleOpenChange = (next: boolean) => {
    // Prevent closing while mutation is in-flight
    if (!next && createMutation.isPending) return;
    if (!next) onCancel?.();
    onOpenChange(next);
  };

  const canSubmit = name.trim().length > 0 && !createMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right-wide" className="flex h-full flex-col gap-0 overflow-hidden p-0">
        <SheetHeader className="border-b border-subtle px-6 py-4">
          <SheetTitle>{t('create')}</SheetTitle>
          <SheetDescription>
            {t('create_description')}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="rounded-xl border border-accent/20 bg-accent/10 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-accent/15 p-2 text-accent">
                  <FolderPlus className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">{t('dialog_guidance_title')}</div>
                  <p className="text-sm leading-6 text-secondary">{t('dialog_guidance_description')}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-surface-high p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                {t('dialog_basics_title')}
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="project-name" className="text-sm font-medium text-foreground">
                    {t('name')}
                  </label>
                  <Input
                    id="project-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('name')}
                    disabled={createMutation.isPending}
                    required
                    className="bg-background"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="project-description" className="text-sm font-medium text-foreground">
                    {t('description')}
                  </label>
                  <textarea
                    id="project-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={commonT('placeholders.enter_description')}
                    rows={3}
                    disabled={createMutation.isPending}
                    className="w-full rounded-md border border-border-input bg-background px-3 py-2 text-foreground placeholder:text-tertiary focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-surface-high p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                {t('dialog_access_title')}
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t('visibility')}</label>
                  <Select
                    value={visibility}
                    onValueChange={(v) => setVisibility(v as 'public' | 'private')}
                    disabled={createMutation.isPending}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">{t('public')}</SelectItem>
                      <SelectItem value="private">{t('private')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t('join_policy')}</label>
                  <Select
                    value={joinPolicy}
                    onValueChange={(v) => setJoinPolicy(v as 'approval_required' | 'open')}
                    disabled={createMutation.isPending}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approval_required">{t('approval_required')}</SelectItem>
                      <SelectItem value="open">{t('open')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
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
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                commonT('create')
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
