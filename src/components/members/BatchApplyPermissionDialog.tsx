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
import type { PermissionTemplate } from '@/lib/api/types';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';

export interface BatchApplyPermissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PermissionTemplate[];
  selectedCount: number;
  onApply: (templateId: string, permissions: string[], template?: 'admin' | 'developer' | 'user' | null) => Promise<void>;
}

const DEFAULT_TEMPLATE_IDS = ['owner', 'admin', 'developer', 'user'];

export function BatchApplyPermissionDialog({
  open,
  onOpenChange,
  templates,
  selectedCount,
  onApply,
}: BatchApplyPermissionDialogProps) {
  const t = useTranslations('members.templates');
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);

  const defaultTemplates = React.useMemo((): PermissionTemplate[] => {
    return [
      { id: 'admin', name: t('default_templates.admin'), permissions: [...ROLE_TEMPLATES.admin], is_default: true, is_readonly: true },
      { id: 'developer', name: t('default_templates.developer'), permissions: [...ROLE_TEMPLATES.developer], is_default: true, is_readonly: true },
      { id: 'user', name: t('default_templates.user'), permissions: [...ROLE_TEMPLATES.user], is_default: true, is_readonly: true },
    ];
  }, [t]);

  const allTemplates = React.useMemo(() => {
    return [...defaultTemplates, ...templates.filter((tpl) => !DEFAULT_TEMPLATE_IDS.includes(tpl.id))];
  }, [defaultTemplates, templates]);

  const selectedTemplate = allTemplates.find((tpl) => tpl.id === selectedTemplateId);

  const handleApply = React.useCallback(async () => {
    if (!selectedTemplate) return;
    const templateId: 'admin' | 'developer' | 'user' | null = DEFAULT_TEMPLATE_IDS.includes(
      selectedTemplate.id
    )
      ? (selectedTemplate.id as 'admin' | 'developer' | 'user')
      : null;
    setSubmitting(true);
    try {
      await onApply(selectedTemplate.id, selectedTemplate.permissions, templateId);
      setSelectedTemplateId('');
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [selectedTemplate, onApply, onOpenChange]);

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
            {t('batch_apply_permission_hint', { count: selectedCount })}
          </p>
          <div className="space-y-2">
            <Label>{t('select_template')}</Label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder={t('select_template')} />
              </SelectTrigger>
              <SelectContent>
                {allTemplates
                  .filter((tpl) => tpl.id !== 'owner')
                  .map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name} ({tpl.permissions.length} {t('permissions_list').toLowerCase()})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleApply}
            disabled={!selectedTemplate || submitting}
          >
            {submitting ? t('applying') : t('apply_to_members')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
