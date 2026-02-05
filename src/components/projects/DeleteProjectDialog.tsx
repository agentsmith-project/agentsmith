'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import type { ProjectWithMembership } from '@/lib/hooks/use-permissions';

export interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectWithMembership | null;
  workspaceId: string;
  onDeleted?: () => void;
  deleteProject: (workspaceId: string, projectId: string) => Promise<void>;
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
  workspaceId,
  onDeleted,
  deleteProject,
}: DeleteProjectDialogProps) {
  const t = useTranslations('projects');
  const commonT = useTranslations('common');

  const handleConfirm = async () => {
    if (!project) return;
    await deleteProject(workspaceId, project.id);
    onDeleted?.();
  };

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('delete_confirm_title')}
      description={t('delete_confirm_message')}
      confirmText={commonT('delete')}
      cancelText={commonT('cancel')}
      variant="destructive"
      onConfirm={handleConfirm}
      errorContext="projects.delete"
    />
  );
}
