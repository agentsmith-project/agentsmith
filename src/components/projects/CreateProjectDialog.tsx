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

function CreateProjectSheetLead({
  icon,
  title,
  description,
  testId,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="border-b border-subtle px-6 py-5" data-testid={testId}>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
          {icon}
        </span>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-sm leading-6 text-secondary">{description}</p>
        </div>
      </div>
    </div>
  );
}

function CreateProjectSheetSection({
  icon,
  title,
  children,
  testId,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className="border-b border-subtle px-6 py-5" data-sheet-section="continuous" data-testid={testId}>
      <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

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
        <SheetHeader className="border-b border-subtle px-6 py-5">
          <SheetTitle>{t('create')}</SheetTitle>
          <SheetDescription>
            {t('create_description')}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto" data-testid="create-project__scaffold" data-structure="continuous-sections">
            <CreateProjectSheetLead
              icon={<FolderPlus className="h-5 w-5" />}
              title={t('dialog_guidance_title')}
              description={t('dialog_guidance_description')}
              testId="create-project__intro"
            />

            <CreateProjectSheetSection
              title={t('dialog_basics_title')}
              testId="create-project__section--basics"
            >
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
            </CreateProjectSheetSection>

            <CreateProjectSheetSection
              icon={<ShieldCheck className="h-3.5 w-3.5 text-accent" />}
              title={t('dialog_access_title')}
              testId="create-project__section--access"
            >
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
            </CreateProjectSheetSection>
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
