'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AlertMetric, AlertOperator, AlertWindow } from '@/lib/types/alerts';

import { METRIC_OPTIONS, OPERATOR_OPTIONS, WINDOW_OPTIONS } from '../constants';
import type { AlertRuleFormData } from '../types';

interface TriggerSectionProps {
  errors: Record<string, string>;
  formData: AlertRuleFormData;
  isSubmitting: boolean;
  t: (key: string) => string;
  onChange: (field: keyof AlertRuleFormData['trigger'], value: string | number) => void;
}

export function TriggerSection({
  errors,
  formData,
  isSubmitting,
  t,
  onChange,
}: TriggerSectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">{t('form.trigger')}</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="metric">{t('form.metric')}</Label>
          <Select
            value={formData.trigger.metric}
            onValueChange={(value) => onChange('metric', value as AlertMetric)}
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
            onValueChange={(value) => onChange('operator', value as AlertOperator)}
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
            onChange={(event) => onChange('threshold', parseFloat(event.target.value) || 0)}
            disabled={isSubmitting}
            data-testid="alert-rule-form-dialog__threshold-input"
            aria-invalid={!!errors.threshold}
          />
          {errors.threshold ? (
            <p className="text-sm text-error" data-testid="alert-rule-form-dialog__threshold-error">
              {errors.threshold}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="window">{t('form.window')}</Label>
          <Select
            value={formData.trigger.window}
            onValueChange={(value) => onChange('window', value as AlertWindow)}
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
  );
}
