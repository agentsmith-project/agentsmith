import type { AlertCenterRule, AlertCenterRuleFormData } from './types';

export function ruleToFormData(rule: AlertCenterRule): AlertCenterRuleFormData {
  return {
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    trigger: rule.trigger,
    channels: rule.channels,
    behavior: rule.behavior,
  };
}
