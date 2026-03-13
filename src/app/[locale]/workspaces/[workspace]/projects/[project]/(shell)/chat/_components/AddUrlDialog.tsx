'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AddUrlDialogProps {
  isPending: boolean;
  open: boolean;
  t: (key: string) => string;
  urlInput: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onUrlInputChange: (value: string) => void;
}

export function AddUrlDialog({
  isPending,
  open,
  t,
  urlInput,
  onConfirm,
  onOpenChange,
  onUrlInputChange,
}: AddUrlDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('composer.url_dialog.title')}</DialogTitle>
          <DialogDescription>{t('composer.url_dialog.description')}</DialogDescription>
        </DialogHeader>
        <Input
          value={urlInput}
          onChange={(event) => onUrlInputChange(event.target.value)}
          placeholder={t('composer.url_dialog.placeholder')}
          autoFocus
          data-testid="chat__url-input"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('composer.cancel')}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending || !/^https?:\/\//i.test(urlInput.trim())}
            data-testid="chat__url-input-confirm"
          >
            {t('composer.url_dialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
