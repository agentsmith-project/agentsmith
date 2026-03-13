'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { AlertRuleFormData } from '../types';

interface ChannelsSectionProps {
  formData: AlertRuleFormData;
  isSubmitting: boolean;
  t: (key: string) => string;
  onChange: (field: keyof AlertRuleFormData['channels'], value: boolean | string) => void;
  onWebhookChange: (url: string) => void;
}

export function ChannelsSection({
  formData,
  isSubmitting,
  t,
  onChange,
  onWebhookChange,
}: ChannelsSectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">{t('form.channels')}</h3>

      <div className="flex items-center space-x-2">
        <Switch
          id="in_app"
          checked={formData.channels.in_app}
          onCheckedChange={(checked) => onChange('in_app', checked)}
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
          onChange={(event) => onWebhookChange(event.target.value)}
          placeholder={t('form.webhook_url_placeholder')}
          disabled={isSubmitting}
          data-testid="alert-rule-form-dialog__webhook-input"
        />
      </div>
    </div>
  );
}
