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
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { CredentialsAPI, getApiClient } from '@/lib/api';
import type { Credential } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';

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
          <div className="space-y-2">
            <label htmlFor="rotate-value" className="text-sm font-medium text-foreground">
              {t('rotate_dialog.new_value')}
            </label>
            <div className="relative">
              <Input
                id="rotate-value"
                type={showValue ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t('rotate_dialog.value_placeholder')}
                disabled={rotateMutation.isPending}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowValue((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-tertiary hover:text-foreground"
                aria-label={showValue ? t('create_dialog.hide') : t('create_dialog.show')}
              >
                {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

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
