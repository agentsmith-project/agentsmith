/**
 * Alert Rule Form Dialog Component
 *
 * Dialog for creating/editing alert rules.
 *
 * @module alerts/AlertRuleFormDialog
 */

'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { BasicInfoSection } from './alert-rule-form-dialog/sections/BasicInfoSection';
import { BehaviorSection } from './alert-rule-form-dialog/sections/BehaviorSection';
import { ChannelsSection } from './alert-rule-form-dialog/sections/ChannelsSection';
import { TriggerSection } from './alert-rule-form-dialog/sections/TriggerSection';
import type { AlertRuleFormData } from './alert-rule-form-dialog/types';
import { getDefaultFormData, validateAlertRuleForm } from './alert-rule-form-dialog/utils';

export type { AlertRuleFormData } from './alert-rule-form-dialog/types';

export interface AlertRuleFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: AlertRuleFormData) => void | Promise<void>;
  initialData?: AlertRuleFormData;
  mode: 'create' | 'edit';
  isSubmitting?: boolean;
}

/**
 * Alert rule form dialog component
 *
 * Features:
 * - Name and description inputs
 * - Metric selector
 * - Operator and threshold inputs
 * - Notification channel configuration
 * - Webhook URL configuration
 * - Debounce and recovery settings
 *
 * @param props - Component props
 * @returns Form dialog component
 */
export function AlertRuleFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
  mode,
  isSubmitting = false,
}: AlertRuleFormDialogProps) {
  const t = useTranslations('alerts');
  const tCommon = useTranslations('common');

  // Form state
  const [formData, setFormData] = React.useState<AlertRuleFormData>(getDefaultFormData);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Reset form when dialog opens or initialData changes
  React.useEffect(() => {
    if (open) {
      setFormData(initialData || getDefaultFormData());
      setErrors({});
    }
  }, [open, initialData]);

  // Handle input changes
  const handleChange = (
    field: keyof AlertRuleFormData,
    value: string | number | boolean
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleTriggerChange = (
    field: keyof AlertRuleFormData['trigger'],
    value: string | number
  ) => {
    setFormData((prev) => ({
      ...prev,
      trigger: { ...prev.trigger, [field]: value },
    }));
  };

  const handleChannelsChange = (field: keyof AlertRuleFormData['channels'], value: boolean | string) => {
    setFormData((prev) => ({
      ...prev,
      channels: { ...prev.channels, [field]: value },
    }));
  };

  const handleWebhookChange = (url: string) => {
    setFormData((prev) => ({
      ...prev,
      channels: {
        ...prev.channels,
        webhook: url ? { url, ...prev.channels.webhook } : undefined,
      },
    }));
  };

  const handleBehaviorChange = (
    field: keyof AlertRuleFormData['behavior'],
    value: number | boolean
  ) => {
    setFormData((prev) => ({
      ...prev,
      behavior: { ...prev.behavior, [field]: value },
    }));
  };

  const validateForm = (): boolean => {
    const newErrors = validateAlertRuleForm(formData);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    await onSubmit(formData);
  };

  const title = mode === 'create' ? t('form.title.create') : t('form.title.edit');
  const submitLabel = mode === 'create' ? tCommon('create') : tCommon('save');

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="alert-rule-form-dialog"
      >
        <DialogHeader>
          <DialogTitle data-testid="alert-rule-form-dialog__title">{title}</DialogTitle>
          <DialogDescription>{t('form.description')}</DialogDescription>
        </DialogHeader>

        <form id="alert-rule-form" onSubmit={handleSubmit} className="space-y-6">
          <BasicInfoSection errors={errors} formData={formData} isSubmitting={isSubmitting} t={t} onChange={handleChange} />
          <TriggerSection errors={errors} formData={formData} isSubmitting={isSubmitting} t={t} onChange={handleTriggerChange} />
          <ChannelsSection formData={formData} isSubmitting={isSubmitting} t={t} onChange={handleChannelsChange} onWebhookChange={handleWebhookChange} />
          <BehaviorSection errors={errors} formData={formData} isSubmitting={isSubmitting} t={t} onChange={handleBehaviorChange} />
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="alert-rule-form-dialog__cancel-btn"
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            form="alert-rule-form"
            disabled={isSubmitting}
            data-testid="alert-rule-form-dialog__submit-btn"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
