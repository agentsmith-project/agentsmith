import type { AlertRuleFormData } from './types';

export function getDefaultFormData(): AlertRuleFormData {
  return {
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
  };
}

export function validateAlertRuleForm(formData: AlertRuleFormData): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!formData.name.trim()) {
    errors.name = 'Name is required';
  }

  if (formData.trigger.threshold <= 0) {
    errors.threshold = 'Threshold must be greater than 0';
  }

  if (formData.behavior.debounce_minutes < 0) {
    errors.debounce_minutes = 'Debounce must be 0 or greater';
  }

  return errors;
}
