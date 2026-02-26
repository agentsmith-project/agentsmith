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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import type { AlertMetric, AlertOperator, AlertWindow } from '@/lib/types/alerts';

// Metric options with display names
const METRIC_OPTIONS: { value: AlertMetric; label: string }[] = [
  { value: 'requests_per_day', label: 'Requests Per Day' },
  { value: 'requests_per_hour', label: 'Requests Per Hour' },
  { value: 'quota_percent', label: 'Quota Percentage' },
  { value: 'error_rate', label: 'Error Rate' },
  { value: 'token_usage', label: 'Token Usage' },
  { value: 'response_time_p95', label: 'Response Time (P95)' },
];

// Operator options with display names
const OPERATOR_OPTIONS: { value: AlertOperator; label: string }[] = [
  { value: 'gt', label: 'Greater Than (>)' },
  { value: 'gte', label: 'Greater Than or Equal (>=)' },
  { value: 'lt', label: 'Less Than (<)' },
  { value: 'lte', label: 'Less Than or Equal (<=)' },
  { value: 'eq', label: 'Equal (=)' },
];

// Time window options with display names
const WINDOW_OPTIONS: { value: AlertWindow; label: string }[] = [
  { value: '5m', label: '5 Minutes' },
  { value: '15m', label: '15 Minutes' },
  { value: '1h', label: '1 Hour' },
  { value: '24h', label: '24 Hours' },
  { value: '7d', label: '7 Days' },
];

export interface AlertRuleFormData {
  name: string;
  description?: string;
  enabled: boolean;
  trigger: {
    metric: AlertMetric;
    operator: AlertOperator;
    threshold: number;
    window?: AlertWindow;
  };
  channels: {
    in_app: boolean;
    webhook?: { url: string; headers?: Record<string, string> };
  };
  behavior: {
    debounce_minutes: number;
    notify_on_recovery: boolean;
  };
}

export interface AlertRuleFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: AlertRuleFormData) => void | Promise<void>;
  initialData?: AlertRuleFormData;
  mode: 'create' | 'edit';
  isSubmitting?: boolean;
}

/**
 * Default form data
 */
const getDefaultFormData = (): AlertRuleFormData => ({
  name: '',
  description: '',
  enabled: true,
  trigger: {
    metric: 'requests_per_hour',
    operator: 'gte',
    threshold: 1000,
    window: '1h',
  },
  channels: {
    in_app: true,
  },
  behavior: {
    debounce_minutes: 5,
    notify_on_recovery: true,
  },
});

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

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (formData.trigger.threshold <= 0) {
      newErrors.threshold = 'Threshold must be greater than 0';
    }

    if (formData.behavior.debounce_minutes < 0) {
      newErrors.debounce_minutes = 'Debounce must be 0 or greater';
    }

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
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Basic Information</h3>
              <div className="flex items-center space-x-2">
                <Switch
                  id="enabled"
                  checked={formData.enabled}
                  onCheckedChange={(checked) => handleChange('enabled', checked)}
                  data-testid="alert-rule-form-dialog__enabled-switch"
                />
                <Label htmlFor="enabled" className="cursor-pointer">
                  {t('form.enabled')}
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name" data-testid="alert-rule-form-dialog__name-label">
                {t('form.name')} <span className="text-error">*</span>
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder={t('form.name_placeholder')}
                disabled={isSubmitting}
                data-testid="alert-rule-form-dialog__name-input"
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <p className="text-sm text-error" data-testid="alert-rule-form-dialog__name-error">
                  {errors.name}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{t('form.description_label')}</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder={t('form.description_placeholder')}
                disabled={isSubmitting}
                data-testid="alert-rule-form-dialog__description-input"
              />
            </div>
          </div>

          {/* Trigger Conditions */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('form.trigger')}</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="metric">{t('form.metric')}</Label>
                <Select
                  value={formData.trigger.metric}
                  onValueChange={(value) => handleTriggerChange('metric', value as AlertMetric)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="metric" data-testid="alert-rule-form-dialog__metric-select">
                    <SelectValue placeholder="Select metric" />
                  </SelectTrigger>
                  <SelectContent>
                    {METRIC_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="operator">{t('form.operator')}</Label>
                <Select
                  value={formData.trigger.operator}
                  onValueChange={(value) => handleTriggerChange('operator', value as AlertOperator)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="operator" data-testid="alert-rule-form-dialog__operator-select">
                    <SelectValue placeholder="Select operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATOR_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="threshold" data-testid="alert-rule-form-dialog__threshold-label">
                  {t('form.threshold')} <span className="text-error">*</span>
                </Label>
                <Input
                  id="threshold"
                  type="number"
                  min="0"
                  value={formData.trigger.threshold}
                  onChange={(e) => handleTriggerChange('threshold', parseFloat(e.target.value) || 0)}
                  disabled={isSubmitting}
                  data-testid="alert-rule-form-dialog__threshold-input"
                  aria-invalid={!!errors.threshold}
                />
                {errors.threshold && (
                  <p className="text-sm text-error" data-testid="alert-rule-form-dialog__threshold-error">
                    {errors.threshold}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="window">{t('form.window')}</Label>
                <Select
                  value={formData.trigger.window}
                  onValueChange={(value) => handleTriggerChange('window', value as AlertWindow)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="window" data-testid="alert-rule-form-dialog__window-select">
                    <SelectValue placeholder="Select window" />
                  </SelectTrigger>
                  <SelectContent>
                    {WINDOW_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Notification Channels */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('form.channels')}</h3>

            <div className="flex items-center space-x-2">
              <Switch
                id="in_app"
                checked={formData.channels.in_app}
                onCheckedChange={(checked) => handleChannelsChange('in_app', checked)}
                disabled={isSubmitting}
                data-testid="alert-rule-form-dialog__in-app-switch"
              />
              <Label htmlFor="in_app" className="cursor-pointer">
                {t('form.in_app')}
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook_url">{t('form.webhook_url')}</Label>
              <Input
                id="webhook_url"
                type="url"
                value={formData.channels.webhook?.url || ''}
                onChange={(e) => handleWebhookChange(e.target.value)}
                placeholder={t('form.webhook_url_placeholder')}
                disabled={isSubmitting}
                data-testid="alert-rule-form-dialog__webhook-input"
              />
            </div>
          </div>

          {/* Behavior */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('form.behavior')}</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="debounce" data-testid="alert-rule-form-dialog__debounce-label">
                  {t('form.debounce')}
                </Label>
                <Input
                  id="debounce"
                  type="number"
                  min="0"
                  value={formData.behavior.debounce_minutes}
                  onChange={(e) =>
                    handleBehaviorChange('debounce_minutes', parseFloat(e.target.value) || 0)
                  }
                  disabled={isSubmitting}
                  data-testid="alert-rule-form-dialog__debounce-input"
                  aria-invalid={!!errors.debounce_minutes}
                />
                {errors.debounce_minutes && (
                  <p className="text-sm text-error">{errors.debounce_minutes}</p>
                )}
              </div>

              <div className="flex items-end space-x-2">
                <Switch
                  id="notify_recovery"
                  checked={formData.behavior.notify_on_recovery}
                  onCheckedChange={(checked) => handleBehaviorChange('notify_on_recovery', checked)}
                  disabled={isSubmitting}
                  data-testid="alert-rule-form-dialog__recovery-switch"
                />
                <Label htmlFor="notify_recovery" className="cursor-pointer pb-2">
                  {t('form.notify_recovery')}
                </Label>
              </div>
            </div>
          </div>
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
