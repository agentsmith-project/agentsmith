'use client';

import { KeyRound, ShieldCheck } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CreateApiKeyDialogProps {
  commonT: (key: string) => string;
  createExpiresIn: string;
  createNote: string;
  isPending: boolean;
  open: boolean;
  t: (key: string) => string;
  onCreate: () => void;
  onCreateExpiresInChange: (value: string) => void;
  onCreateNoteChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}

export function CreateApiKeyDialog({
  commonT,
  createExpiresIn,
  createNote,
  isPending,
  open,
  t,
  onCreate,
  onCreateExpiresInChange,
  onCreateNoteChange,
  onOpenChange,
}: CreateApiKeyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" data-testid="api-keys__create-dialog">
        <DialogHeader className="space-y-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <KeyRound className="h-3.5 w-3.5" />
            API Key
          </div>
          <DialogTitle>{t('create')}</DialogTitle>
          <DialogDescription>
            Create a new API key. You can add an optional note and expiration.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="rounded-2xl border border-accent/20 bg-accent/10 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl bg-accent/15 p-2.5 text-accent">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">{t('dialog_guidance_title')}</div>
                <p className="text-sm leading-6 text-secondary">{t('dialog_guidance_description')}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-surface-high p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
              <KeyRound className="h-3.5 w-3.5 text-accent" />
              {t('dialog_settings_title')}
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('note')}</label>
                <Input
                  value={createNote}
                  onChange={(event) => onCreateNoteChange(event.target.value)}
                  placeholder={t('note')}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('expires')}</label>
                <Input
                  type="number"
                  min="1"
                  value={createExpiresIn}
                  onChange={(event) => onCreateExpiresInChange(event.target.value)}
                  placeholder={t('expiration_never')}
                  disabled={isPending}
                />
                <p className="text-xs text-tertiary">Leave empty for no expiration (days)</p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {commonT('cancel')}
          </Button>
          <Button variant="action" onClick={onCreate} disabled={isPending}>
            {isPending ? 'Creating...' : t('create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
