'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { AlertRuleFormData } from '../types';

interface BasicInfoSectionProps {
  errors: Record<string, string>;
  formData: AlertRuleFormData;
  isSubmitting: boolean;
  t: (key: string) => string;
  onChange: (field: keyof AlertRuleFormData, value: string | number | boolean) => void;
}

export function BasicInfoSection({
  errors,
  formData,
  isSubmitting,
  t,
  onChange,
}: BasicInfoSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Basic Information</h3>
        <div className="flex items-center space-x-2">
          <Switch
            id="enabled"
            checked={formData.enabled}
            onCheckedChange={(checked) => onChange('enabled', checked)}
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
          onChange={(event) => onChange('name', event.target.value)}
          placeholder={t('form.name_placeholder')}
          disabled={isSubmitting}
          data-testid="alert-rule-form-dialog__name-input"
          aria-invalid={!!errors.name}
        />
        {errors.name ? (
          <p className="text-sm text-error" data-testid="alert-rule-form-dialog__name-error">
            {errors.name}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{t('form.description_label')}</Label>
        <Input
          id="description"
          value={formData.description}
          onChange={(event) => onChange('description', event.target.value)}
          placeholder={t('form.description_placeholder')}
          disabled={isSubmitting}
          data-testid="alert-rule-form-dialog__description-input"
        />
      </div>
    </div>
  );
}
