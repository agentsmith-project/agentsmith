'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { FileLibrary, FileLibraryRestorePreview, FileLibrarySavePoint, TaskFileTemplate } from '@/lib/api/types';
import {
  useCancelFileLibraryRestore,
  useCreateFileLibraryRestorePreview,
  useCreateFileLibrarySavePoint,
  useFileLibrarySavePoints,
  useRunFileLibraryRestore,
} from '@/lib/hooks/use-file-library-recovery';
import {
  useCreateTaskFileTemplate,
  useDeleteTaskFileTemplate,
  usePublishTaskFileTemplate,
  useTaskFileTemplates,
  useUnpublishTaskFileTemplate,
} from '@/lib/hooks/use-task-file-templates';
import { cn } from '@/lib/utils';

type FileLibraryRecoveryDialogProps = {
  library: FileLibrary | null;
  open: boolean;
  projectId: string;
  t: (key: string, values?: Record<string, string>) => string;
  workspaceId: string;
  onOpenChange: (open: boolean) => void;
};

type FileStatesTab = 'save_points' | 'task_templates';
type RestorePreviewDisplay = {
  blockers: string[];
  canConfirm: boolean;
  isFailed: boolean;
  summary: string;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function savePointLabel(savePoint: FileLibrarySavePoint, t: FileLibraryRecoveryDialogProps['t']) {
  return savePoint.message?.trim() || t('file_manager.save_point_default_name');
}

function buildRestorePreviewDisplay(
  restorePreview: FileLibraryRestorePreview,
  t: FileLibraryRecoveryDialogProps['t'],
): RestorePreviewDisplay {
  const status = restorePreview.status;
  const stale = restorePreview.stale === true;
  const displayBlockers = (restorePreview.blockers ?? []).map((blocker) => {
    if (blocker.message?.trim()) return blocker.message;
    return t('file_manager.restore_preview_blocked_default');
  });
  const isFailed = status === 'failed';
  const isReady = status === 'ready';
  const typedSummary = restorePreview.summary
    ? t('file_manager.restore_preview_summary_counts', {
        added: String(restorePreview.summary.added.count),
        changed: String(restorePreview.summary.changed.count),
        removed: String(restorePreview.summary.removed.count),
      })
    : null;
  const summary = stale
    ? t('file_manager.restore_preview_stale_default')
    : isFailed
      ? t('file_manager.restore_preview_failed_default')
      : displayBlockers.length > 0
        ? t('file_manager.restore_preview_blocked_default')
        : typedSummary ?? (isReady
          ? t('file_manager.restore_preview_summary_default')
          : t('file_manager.restore_preview_not_ready_default'));

  return {
    blockers: displayBlockers,
    canConfirm: isReady && !stale && !isFailed && displayBlockers.length === 0,
    isFailed,
    summary,
  };
}

function TemplateStatusBadge({
  status,
  t,
}: {
  status: TaskFileTemplate['status'];
  t: FileLibraryRecoveryDialogProps['t'];
}) {
  const tone = status === 'published'
    ? 'border-success/25 bg-success/10 text-success'
    : status === 'failed'
      ? 'border-error/25 bg-error/10 text-error'
      : 'border-subtle bg-surface-high/30 text-secondary';

  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase', tone)}>
      {t(`file_manager.task_template_status_${status}`)}
    </span>
  );
}

export function FileLibraryRecoveryDialog({
  library,
  open,
  projectId,
  t,
  workspaceId,
  onOpenChange,
}: FileLibraryRecoveryDialogProps) {
  const [activeTab, setActiveTab] = React.useState<FileStatesTab>('save_points');
  const [savePointMessage, setSavePointMessage] = React.useState('');
  const [restorePreview, setRestorePreview] = React.useState<FileLibraryRestorePreview | null>(null);
  const [templateName, setTemplateName] = React.useState('');
  const [templateDescription, setTemplateDescription] = React.useState('');

  const libraryId = library?.id ?? '';
  const libraryReady = library?.status === 'ready';

  const savePointsQuery = useFileLibrarySavePoints(workspaceId, projectId, libraryId, {
    enabled: open && !!libraryId,
  });
  const templatesQuery = useTaskFileTemplates(workspaceId, projectId, {
    enabled: open,
  });

  const createSavePoint = useCreateFileLibrarySavePoint();
  const createRestorePreview = useCreateFileLibraryRestorePreview();
  const runRestore = useRunFileLibraryRestore();
  const cancelRestore = useCancelFileLibraryRestore();
  const createTemplate = useCreateTaskFileTemplate();
  const publishTemplate = usePublishTaskFileTemplate();
  const unpublishTemplate = useUnpublishTaskFileTemplate();
  const deleteTemplate = useDeleteTaskFileTemplate();

  React.useEffect(() => {
    if (!open) {
      setSavePointMessage('');
      setTemplateName('');
      setTemplateDescription('');
      setRestorePreview(null);
      setActiveTab('save_points');
    }
  }, [open]);

  const savePoints = savePointsQuery.data?.items ?? [];
  const templates = templatesQuery.data?.items ?? [];
  const templatesForLibrary = templates.filter((template) => template.source_library_id === libraryId);
  const restorePreviewDisplay = restorePreview ? buildRestorePreviewDisplay(restorePreview, t) : null;

  const handleCreateSavePoint = async () => {
    if (!library || !libraryReady) return;
    await createSavePoint.mutateAsync({
      workspaceId,
      projectId,
      libraryId: library.id,
      message: savePointMessage.trim() || undefined,
    });
    setSavePointMessage('');
  };

  const handlePreviewRestore = async (savePoint: FileLibrarySavePoint) => {
    if (!library || !libraryReady) return;
    const preview = await createRestorePreview.mutateAsync({
      workspaceId,
      projectId,
      libraryId: library.id,
      savePointId: savePoint.id,
    });
    setRestorePreview(preview);
  };

  const handleCancelRestore = async () => {
    if (!library || !restorePreview) {
      setRestorePreview(null);
      return;
    }
    await cancelRestore.mutateAsync({
      workspaceId,
      projectId,
      libraryId: library.id,
      restorePreviewId: restorePreview.id,
    });
    setRestorePreview(null);
  };

  const handleRunRestore = async () => {
    if (!library || !restorePreview || !libraryReady) return;
    const previewDisplay = buildRestorePreviewDisplay(restorePreview, t);
    if (!previewDisplay.canConfirm) return;
    await runRestore.mutateAsync({
      workspaceId,
      projectId,
      libraryId: library.id,
      restorePreviewId: restorePreview.id,
    });
    setRestorePreview(null);
    onOpenChange(false);
  };

  const handlePublishCurrentState = async () => {
    if (!library || !libraryReady || !templateName.trim()) return;
    const template = await createTemplate.mutateAsync({
      workspaceId,
      projectId,
      sourceLibraryId: library.id,
      name: templateName.trim(),
      description: templateDescription.trim() || undefined,
    });
    await publishTemplate.mutateAsync({
      workspaceId,
      projectId,
      templateId: template.id,
    });
    setTemplateName('');
    setTemplateDescription('');
  };

  const handleTemplatePublish = (templateId: string) => publishTemplate.mutateAsync({
    workspaceId,
    projectId,
    templateId,
  });

  const handleTemplateUnpublish = (templateId: string) => unpublishTemplate.mutateAsync({
    workspaceId,
    projectId,
    templateId,
  });

  const handleTemplateDelete = (templateId: string) => deleteTemplate.mutateAsync({
    workspaceId,
    projectId,
    templateId,
  });

  const savePointPending = createSavePoint.isPending;
  const restorePending = createRestorePreview.isPending || runRestore.isPending || cancelRestore.isPending;
  const templatePending = createTemplate.isPending || publishTemplate.isPending || unpublishTemplate.isPending || deleteTemplate.isPending;
  const restoreConfirmDisabled = !libraryReady || restorePending || !restorePreviewDisplay?.canConfirm;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]" data-testid="files__dialog__file-states">
        <DialogHeader>
          <DialogTitle>{t('file_manager.file_states')}</DialogTitle>
          <DialogDescription>
            {library
              ? t('file_manager.file_state_dialog_description', { name: library.name })
              : t('file_manager.file_state_dialog_no_library')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 rounded-md border border-subtle bg-surface/40 px-3 py-2.5 text-sm text-secondary" data-testid="files__file-states-scope">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" />
          <div>{t('file_manager.file_state_scope_notice')}</div>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FileStatesTab)}>
          <TabsList>
            <TabsTrigger value="save_points">{t('file_manager.save_points')}</TabsTrigger>
            <TabsTrigger value="task_templates">{t('file_manager.task_templates')}</TabsTrigger>
          </TabsList>

          <TabsContent value="save_points" className="space-y-4">
            <div className="grid gap-3 rounded-md border border-subtle bg-surface/30 p-3">
              <div className="text-sm text-tertiary">{t('file_manager.save_point_scope_hint')}</div>
              <div className="space-y-1.5">
                <Label htmlFor="file-state-save-point-message">{t('file_manager.save_point_message')}</Label>
                <Input
                  id="file-state-save-point-message"
                  value={savePointMessage}
                  onChange={(event) => setSavePointMessage(event.target.value)}
                  placeholder={t('file_manager.save_point_message_placeholder')}
                  disabled={!libraryReady || savePointPending}
                  data-testid="files__save-point__message"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleCreateSavePoint}
                  disabled={!libraryReady || savePointPending}
                  data-testid="files__save-point__create"
                >
                  {savePointPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('file_manager.save_point_create')}
                </Button>
              </div>
            </div>

            {restorePreview && restorePreviewDisplay ? (
              <div
                className={cn(
                  'rounded-md border px-3 py-3',
                  restorePreviewDisplay.isFailed
                    ? 'border-error/25 bg-error/10'
                    : 'border-warning/30 bg-warning/10',
                )}
                data-testid="files__restore-preview"
              >
                <div className="flex gap-2">
                  {restorePreviewDisplay.canConfirm ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  ) : (
                    <AlertTriangle className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      restorePreviewDisplay.isFailed ? 'text-error' : 'text-warning',
                    )} />
                  )}
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-medium text-primary">
                      {t('file_manager.restore_preview_ready', {
                        name: restorePreview.message || t('file_manager.restore_preview_target_default'),
                      })}
                    </div>
                    <div className="text-sm text-secondary" data-testid="files__restore-preview-summary">
                      {restorePreviewDisplay.summary}
                    </div>
                    {restorePreviewDisplay.blockers.length > 0 ? (
                      <div className="pt-1" data-testid="files__restore-preview-blockers">
                        <div className="text-xs font-medium text-primary">
                          {t('file_manager.restore_preview_blockers_title')}
                        </div>
                        <ul className="mt-1 space-y-1 text-sm text-secondary">
                          {restorePreviewDisplay.blockers.map((blocker) => (
                            <li key={blocker} className="flex gap-2">
                              <span className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full bg-current" />
                              <span>{blocker}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancelRestore}
                    disabled={restorePending}
                    data-testid="files__restore-cancel"
                  >
                    {t('file_manager.restore_cancel')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleRunRestore}
                    disabled={restoreConfirmDisabled}
                    data-testid="files__restore-confirm"
                  >
                    {restorePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t('file_manager.restore_confirm')}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="max-h-[280px] overflow-auto rounded-md border border-subtle">
              {savePointsQuery.isLoading ? (
                <div className="px-3 py-6 text-center text-sm text-tertiary">{t('file_manager.loading')}</div>
              ) : savePoints.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-tertiary">{t('file_manager.save_point_empty')}</div>
              ) : (
                <div className="divide-y divide-subtle">
                  {savePoints.map((savePoint) => (
                    <div key={savePoint.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-primary">{savePointLabel(savePoint, t)}</div>
                        <div className="text-xs text-tertiary">{formatTimestamp(savePoint.created_at)}</div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handlePreviewRestore(savePoint)}
                        disabled={!libraryReady || restorePending}
                        data-testid={`files__save-point__restore--${savePoint.id}`}
                      >
                        {t('file_manager.restore')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="task_templates" className="space-y-4">
            <div className="grid gap-3 rounded-md border border-subtle bg-surface/30 p-3">
              <div className="text-sm text-tertiary">{t('file_manager.task_template_scope_hint')}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="file-state-template-name">{t('file_manager.task_template_name')}</Label>
                  <Input
                    id="file-state-template-name"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder={t('file_manager.task_template_name_placeholder')}
                    disabled={!libraryReady || templatePending}
                    data-testid="files__template__name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="file-state-template-description">{t('file_manager.task_template_description')}</Label>
                  <Input
                    id="file-state-template-description"
                    value={templateDescription}
                    onChange={(event) => setTemplateDescription(event.target.value)}
                    placeholder={t('file_manager.task_template_description_placeholder')}
                    disabled={!libraryReady || templatePending}
                    data-testid="files__template__description"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handlePublishCurrentState}
                  disabled={!libraryReady || !templateName.trim() || templatePending}
                  data-testid="files__template__publish-current"
                >
                  {templatePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('file_manager.task_template_publish_current')}
                </Button>
              </div>
            </div>

            <div className="max-h-[280px] overflow-auto rounded-md border border-subtle">
              {templatesQuery.isLoading ? (
                <div className="px-3 py-6 text-center text-sm text-tertiary">{t('file_manager.loading')}</div>
              ) : templatesForLibrary.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-tertiary">{t('file_manager.task_template_empty')}</div>
              ) : (
                <div className="divide-y divide-subtle">
                  {templatesForLibrary.map((template) => (
                    <div key={template.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-medium text-primary">{template.name}</div>
                          <TemplateStatusBadge status={template.status} t={t} />
                        </div>
                        {template.description ? (
                          <div className="mt-0.5 truncate text-xs text-tertiary">{template.description}</div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {template.status === 'published' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleTemplateUnpublish(template.id)}
                            disabled={templatePending}
                            data-testid={`files__template__unpublish--${template.id}`}
                          >
                            {t('file_manager.template_unpublish')}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleTemplatePublish(template.id)}
                            disabled={templatePending || template.status === 'failed'}
                            data-testid={`files__template__publish--${template.id}`}
                          >
                            {t('file_manager.template_publish')}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleTemplateDelete(template.id)}
                          disabled={templatePending}
                          data-testid={`files__template__delete--${template.id}`}
                        >
                          {t('file_manager.delete')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('file_manager.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
