import type { Alert, AlertRule } from '@/lib/types/alerts';

export type AlertCenterTabValue = 'rules' | 'notifications';

export interface AlertCenterRuleFormData {
  name: string;
  description?: string;
  enabled: boolean;
  trigger: AlertRule['trigger'];
  channels: AlertRule['channels'];
  behavior: AlertRule['behavior'];
}

export type AlertCenterRule = AlertRule;
export type AlertCenterNotification = Alert;
