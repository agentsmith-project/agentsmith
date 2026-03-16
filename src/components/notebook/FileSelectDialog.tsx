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
import { FilesTable } from '@/components/files/FilesTable';
export interface FileSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FileSelectDialog({
  open,
  onOpenChange,
}: FileSelectDialogProps) {
  const t = useTranslations('notebook.attached_files.select_dialog');
  const tCommon = useTranslations('common');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="space-y-4">
            <div className="border border-dashed border-subtle rounded-md p-4 space-y-2 bg-surface/50">
              <div className="text-sm font-medium text-primary">{t('legacy_source_title')}</div>
              <p className="text-sm text-tertiary">{t('legacy_source_description')}</p>
              <div className="pointer-events-none opacity-60">
                <FilesTable data={[]} selectedIds={[]} onRowSelect={() => {}} />
              </div>
            </div>

            <div className="border border-subtle rounded-md p-3 space-y-3">
              <div className="text-sm font-medium text-primary">
                {t('library_objects_title')}
              </div>
              <div className="rounded-md border border-subtle bg-surface/40 px-3 py-3 text-sm text-tertiary">
                {t('legacy_source_description')}
              </div>
              <p className="text-xs text-tertiary">
                {t('legacy_source_footer')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-subtle">
          <div className="text-sm text-tertiary">{t('legacy_source_footer')}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
