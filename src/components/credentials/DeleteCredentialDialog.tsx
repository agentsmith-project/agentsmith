'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import type { Credential } from '@/lib/api/types';

export interface DeleteCredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credential: Credential | null;
  onConfirm: () => Promise<void>;
}

export function DeleteCredentialDialog({
  open,
  onOpenChange,
  credential,
  onConfirm,
}: DeleteCredentialDialogProps) {
  const t = useTranslations('credentials');
  const commonT = useTranslations('common');

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('delete_dialog.title')}
      description={t('delete_dialog.description', { name: credential?.name ?? '' })}
      confirmText={commonT('delete')}
      cancelText={commonT('cancel')}
      variant="destructive"
      onConfirm={onConfirm}
      errorContext="credentials.delete"
      testId="credentials__delete-dialog"
    />
  );
}
