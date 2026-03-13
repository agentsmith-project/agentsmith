import type { AlertMetric, AlertOperator, AlertWindow } from '@/lib/types/alerts';

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
