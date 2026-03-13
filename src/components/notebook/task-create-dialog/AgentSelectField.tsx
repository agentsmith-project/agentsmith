'use client';

import { Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function AgentSelectField(args: {
  t: (key: string) => string;
  commonT: (key: string) => string;
  value: string;
  disabled: boolean;
  loading: boolean;
  agents: Array<{ id: string; name: string; mode: string; presence?: string }>;
  isAgentSelectable: (agent: { mode: string; presence?: string }) => boolean;
  onValueChange: (value: string) => void;
}) {
  const { t, commonT, value, disabled, loading, agents, isAgentSelectable, onValueChange } = args;

  return (
    <div className="space-y-2">
      <label htmlFor="task-agent" className="text-sm font-medium text-foreground">
        {t('select_agent')}
      </label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id="task-agent">
          <SelectValue placeholder={t('select_agent')} />
        </SelectTrigger>
        <SelectContent>
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-tertiary" />
            </div>
          ) : agents.length === 0 ? (
            <div className="py-4 text-center text-sm text-tertiary">{commonT('empty')}</div>
          ) : (
            agents.map((agent) => (
              <SelectItem
                key={agent.id}
                value={agent.id}
                disabled={!isAgentSelectable(agent)}
              >
                {agent.name}
                {!isAgentSelectable(agent) ? ` (${t('agent_option_offline')})` : ''}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <p className="text-xs text-tertiary">{t('agent_online_only_hint')}</p>
    </div>
  );
}
