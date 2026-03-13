'use client';

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
      <DialogContent className="sm:max-w-[425px]" data-testid="api-keys__create-dialog">
        <DialogHeader>
          <DialogTitle>{t('create')}</DialogTitle>
          <DialogDescription>
            Create a new API key. You can add an optional note and expiration.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
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
