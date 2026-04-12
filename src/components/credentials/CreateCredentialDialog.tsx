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
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { CredentialsAPI, getApiClient } from '@/lib/api';
import type { CreateCredentialRequest } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';
import { CredentialSecretField } from '@/components/credentials/CredentialSecretField';

export interface CreateCredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
}

export function CreateCredentialDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: CreateCredentialDialogProps) {
  const t = useTranslations('credentials');
  const commonT = useTranslations('common');
  const { handleError } = useApiError();
  const [name, setName] = React.useState('');
  const [value, setValue] = React.useState('');
  const [showValue, setShowValue] = React.useState(false);

  const credentialsAPI = React.useMemo(() => new CredentialsAPI(getApiClient()), []);

  const createMutation = useMutation({
    mutationFn: async (data: CreateCredentialRequest) => {
      return credentialsAPI.create(workspaceId, projectId, data);
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
    setValue('');
    setShowValue(false);
  };

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !value.trim()) return;

    createMutation.mutate({
      name: name.trim(),
      type: 'api_key',
      value: value,
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !createMutation.isPending) {
      onOpenChange(next);
    }
  };

  const canSubmit = name.trim().length > 0 && value.length > 0 && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[540px]" data-testid="credentials__create-dialog">
        <DialogHeader className="space-y-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <KeyRound className="h-3.5 w-3.5" />
            Credential
          </div>
          <DialogTitle>{t('create_dialog.title')}</DialogTitle>
          <DialogDescription>{t('create_dialog.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-lg border border-subtle bg-surface-low p-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <p className="text-sm leading-6 text-secondary">{t('create_dialog.guidance')}</p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-subtle bg-surface-low p-4">
            <label htmlFor="cred-name" className="text-sm font-medium text-foreground">
              {t('create_dialog.name')}
            </label>
            <Input
              id="cred-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create_dialog.name_placeholder')}
              disabled={createMutation.isPending}
              required
            />
          </div>

          <div className="rounded-lg border border-subtle bg-surface-low p-4">
            <CredentialSecretField
              id="cred-value"
              label={t('create_dialog.value')}
              value={value}
              placeholder={t('create_dialog.value_placeholder')}
              disabled={createMutation.isPending}
              required
              showValue={showValue}
              showLabel={t('create_dialog.show')}
              hideLabel={t('create_dialog.hide')}
              onValueChange={setValue}
              onToggleVisibility={() => setShowValue((v) => !v)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
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
      </DialogContent>
    </Dialog>
  );
}
