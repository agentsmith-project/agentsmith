'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { handleErrorForToast } from '@/lib/api';
import type { Project as AuthProject } from '@/lib/stores/authStore';

export interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: AuthProject | null;
  workspaceId: string;
  onConfirm: () => void;
  onDeleted?: () => void;
  deleteProject: (workspaceId: string, projectId: string) => Promise<void>;
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
  workspaceId,
  onConfirm,
  onDeleted,
  deleteProject,
}: DeleteProjectDialogProps) {
  const t = useTranslations('projects');
  const commonT = useTranslations('common');
  const [deleting, setDeleting] = React.useState(false);

  const handleConfirm = async () => {
    if (!project) return;
    setDeleting(true);
    try {
      await deleteProject(workspaceId, project.id);
      onOpenChange(false);
      onDeleted?.();
      onConfirm();
    } catch (error) {
      handleErrorForToast(error);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('delete_confirm_message')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{commonT('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={deleting}
            className="bg-error hover:bg-error/90"
          >
            {deleting ? 'Deleting...' : commonT('delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
