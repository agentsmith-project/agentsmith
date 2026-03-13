'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { AlertRuleFormData } from '../types';

interface BehaviorSectionProps {
  errors: Record<string, string>;
  formData: AlertRuleFormData;
  isSubmitting: boolean;
  t: (key: string) => string;
  onChange: (field: keyof AlertRuleFormData['behavior'], value: number | boolean) => void;
}

export function BehaviorSection({
  errors,
  formData,
  isSubmitting,
  t,
  onChange,
}: BehaviorSectionProps) {
  return (
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
            onChange={(event) => onChange('debounce_minutes', parseFloat(event.target.value) || 0)}
            disabled={isSubmitting}
            data-testid="alert-rule-form-dialog__debounce-input"
            aria-invalid={!!errors.debounce_minutes}
          />
          {errors.debounce_minutes ? <p className="text-sm text-error">{errors.debounce_minutes}</p> : null}
        </div>

        <div className="flex items-end space-x-2">
          <Switch
            id="notify_recovery"
            checked={formData.behavior.notify_on_recovery}
            onCheckedChange={(checked) => onChange('notify_on_recovery', checked)}
            disabled={isSubmitting}
            data-testid="alert-rule-form-dialog__recovery-switch"
          />
          <Label htmlFor="notify_recovery" className="cursor-pointer pb-2">
            {t('form.notify_recovery')}
          </Label>
        </div>
      </div>
    </div>
  );
}
