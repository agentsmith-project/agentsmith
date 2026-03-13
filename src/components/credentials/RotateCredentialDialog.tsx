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
import { Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { CredentialsAPI, getApiClient } from '@/lib/api';
import type { Credential } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';
import { CredentialSecretField } from '@/components/credentials/CredentialSecretField';

export interface RotateCredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credential: Credential | null;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
}

export function RotateCredentialDialog({
  open,
  onOpenChange,
  credential,
  workspaceId,
  projectId,
  onSuccess,
}: RotateCredentialDialogProps) {
  const t = useTranslations('credentials');
  const commonT = useTranslations('common');
  const { handleError } = useApiError();
  const [value, setValue] = React.useState('');
  const [showValue, setShowValue] = React.useState(false);

  const credentialsAPI = React.useMemo(() => new CredentialsAPI(getApiClient()), []);

  const rotateMutation = useMutation({
    mutationFn: async (newValue: string) => {
      if (!credential) throw new Error('No credential');
      return credentialsAPI.rotate(workspaceId, projectId, credential.id, newValue);
    },
    onSuccess: () => {
      onOpenChange(false);
      resetForm();
      toast.success(t('rotate_dialog.success'));
      onSuccess?.();
    },
    onError: (error) => {
      handleError(error, { context: t('rotate_dialog.title') });
    },
  });

  const resetForm = () => {
    setValue('');
    setShowValue(false);
  };

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open, credential?.id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;

    rotateMutation.mutate(value);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !rotateMutation.isPending) {
      onOpenChange(next);
    }
  };

  const canSubmit = value.length > 0 && !rotateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="credentials__rotate-dialog">
        <DialogHeader>
          <DialogTitle>{t('rotate_dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('rotate_dialog.description', { name: credential?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <CredentialSecretField
            id="rotate-value"
            label={t('rotate_dialog.new_value')}
            value={value}
            placeholder={t('rotate_dialog.value_placeholder')}
            disabled={rotateMutation.isPending}
            required
            showValue={showValue}
            showLabel={t('create_dialog.show')}
            hideLabel={t('create_dialog.hide')}
            onValueChange={setValue}
            onToggleVisibility={() => setShowValue((v) => !v)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={rotateMutation.isPending}
            >
              {commonT('cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {rotateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t('rotate')
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
