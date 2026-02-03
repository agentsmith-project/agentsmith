'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { QuotaTemplate } from '@/lib/api/types';

export interface BatchApplyQuotaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: QuotaTemplate[];
  selectedCount: number;
  onApply: (templateId: string) => Promise<void>;
}

export function BatchApplyQuotaDialog({
  open,
  onOpenChange,
  templates,
  selectedCount,
  onApply,
}: BatchApplyQuotaDialogProps) {
  const t = useTranslations('members.templates');
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleApply = React.useCallback(async () => {
    if (!selectedTemplateId) return;
    setSubmitting(true);
    try {
      await onApply(selectedTemplateId);
      setSelectedTemplateId('');
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [selectedTemplateId, onApply, onOpenChange]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) setSelectedTemplateId('');
      onOpenChange(next);
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('apply_to_members')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-tertiary">
            {t('batch_apply_quota_hint', { count: selectedCount })}
          </p>
          <div className="space-y-2">
            <Label>{t('select_template')}</Label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder={t('select_template')} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                    {tpl.description && ` — ${tpl.description}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {templates.length === 0 && (
            <p className="text-sm text-tertiary">{t('quota_empty_title')}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleApply}
            disabled={!selectedTemplateId || templates.length === 0 || submitting}
          >
            {submitting ? t('applying') : t('apply_to_members')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
