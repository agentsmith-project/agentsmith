'use client';

import { Plus, Trash2 } from 'lucide-react';
import { INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS, INTERNAL_AGENT_MAX_LIFETIME_MIN_SECONDS } from '@mbos/contracts';

import { Input } from '@/components/ui/input';

import type { AgentEndpointOption, EnvEntry } from './types';
import { endpointLabel } from './utils';

interface InternalAgentSectionProps {
  cpuLimit: string;
  cpuRequest: string;
  createPending: boolean;
  endpointOptions: AgentEndpointOption[];
  envEntries: EnvEntry[];
  idleTimeoutSec: string;
  image: string;
  maxConcurrentSessions: string;
  maxLifetimeSec: string;
  memoryLimit: string;
  memoryRequest: string;
  executionEndpointId: string;
  interactionKind: 'chat' | 'notebook';
  t: (key: string) => string;
  onAddEnvEntry: () => void;
  onCpuLimitChange: (value: string) => void;
  onCpuRequestChange: (value: string) => void;
  onIdleTimeoutSecChange: (value: string) => void;
  onImageChange: (value: string) => void;
  onMaxConcurrentSessionsChange: (value: string) => void;
  onMaxLifetimeSecChange: (value: string) => void;
  onMemoryLimitChange: (value: string) => void;
  onMemoryRequestChange: (value: string) => void;
  onExecutionEndpointIdChange: (value: string) => void;
  onRemoveEnvEntry: (index: number) => void;
  onUpdateEnvEntry: (index: number, field: 'key' | 'value', value: string) => void;
}

export function InternalAgentSection({
  cpuLimit,
  cpuRequest,
  createPending,
  endpointOptions,
  envEntries,
  idleTimeoutSec,
  image,
  maxConcurrentSessions,
  maxLifetimeSec,
  memoryLimit,
  memoryRequest,
  executionEndpointId,
  interactionKind,
  t,
  onAddEnvEntry,
  onCpuLimitChange,
  onCpuRequestChange,
  onIdleTimeoutSecChange,
  onImageChange,
  onMaxConcurrentSessionsChange,
  onMaxLifetimeSecChange,
  onMemoryLimitChange,
  onMemoryRequestChange,
  onExecutionEndpointIdChange,
  onRemoveEnvEntry,
  onUpdateEnvEntry,
}: InternalAgentSectionProps) {
  return (
    <div className="space-y-4 p-4 rounded-sm border border-subtle bg-surface-low">
      <h4 className="text-sm font-medium text-foreground">{t('create_dialog.config_title')}</h4>

      <div className="space-y-2">
        <label htmlFor="agent-image" className="text-sm text-primary">
          {t('create_dialog.image')} <span className="text-error">*</span>
        </label>
        <Input
          id="agent-image"
          value={image}
          onChange={(event) => onImageChange(event.target.value)}
          placeholder="e.g. my-agent:v1.0"
          disabled={createPending}
          className="font-mono text-sm"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="internal-execution-endpoint-id" className="text-sm text-primary">
          {interactionKind === 'chat' ? t('create_dialog.chat_endpoint_id') : t('create_dialog.notebook_endpoint_id')} <span className="text-error">*</span>
        </label>
        <select
          id="internal-execution-endpoint-id"
          value={executionEndpointId}
          onChange={(event) => onExecutionEndpointIdChange(event.target.value)}
          disabled={createPending}
          className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          {endpointOptions.length === 0 ? (
            <option value="">
              {interactionKind === 'chat' ? t('create_dialog.chat_endpoint_empty') : t('create_dialog.notebook_endpoint_empty')}
            </option>
          ) : null}
          {endpointOptions.map((endpoint) => (
            <option key={endpoint.id} value={endpoint.id}>
              {endpointLabel(endpoint)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-primary">{t('create_dialog.env')}</label>
        <div className="space-y-2">
          {envEntries.map((entry, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={entry.key}
                onChange={(event) => onUpdateEnvEntry(index, 'key', event.target.value)}
                placeholder="KEY"
                disabled={createPending}
                className="font-mono text-sm flex-1"
              />
              <Input
                value={entry.value}
                onChange={(event) => onUpdateEnvEntry(index, 'value', event.target.value)}
                placeholder="value"
                disabled={createPending}
                className="font-mono text-sm flex-1"
              />
              <button
                type="button"
                onClick={() => onRemoveEnvEntry(index)}
                disabled={createPending || envEntries.length <= 1}
                className="p-2 text-tertiary hover:text-error disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={onAddEnvEntry}
            disabled={createPending}
            className="flex items-center gap-1 text-sm text-accent hover:underline"
          >
            <Plus className="w-4 h-4" />
            {t('create_dialog.add_env')}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="agent-max-sessions" className="text-sm text-primary">
          {t('create_dialog.max_concurrent_sessions')}
        </label>
        <Input
          id="agent-max-sessions"
          type="number"
          min={1}
          value={maxConcurrentSessions}
          onChange={(event) => onMaxConcurrentSessionsChange(event.target.value)}
          placeholder={t('create_dialog.max_concurrent_sessions_placeholder')}
          disabled={createPending}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label htmlFor="internal-agent-cpu-request" className="text-sm text-primary">{t('create_dialog.cpu_request')}</label>
          <Input id="internal-agent-cpu-request" value={cpuRequest} onChange={(event) => onCpuRequestChange(event.target.value)} disabled={createPending} />
        </div>
        <div className="space-y-2">
          <label htmlFor="internal-agent-cpu-limit" className="text-sm text-primary">{t('create_dialog.cpu_limit')}</label>
          <Input id="internal-agent-cpu-limit" value={cpuLimit} onChange={(event) => onCpuLimitChange(event.target.value)} disabled={createPending} />
        </div>
        <div className="space-y-2">
          <label htmlFor="internal-agent-memory-request" className="text-sm text-primary">{t('create_dialog.memory_request')}</label>
          <Input id="internal-agent-memory-request" value={memoryRequest} onChange={(event) => onMemoryRequestChange(event.target.value)} disabled={createPending} />
        </div>
        <div className="space-y-2">
          <label htmlFor="internal-agent-memory-limit" className="text-sm text-primary">{t('create_dialog.memory_limit')}</label>
          <Input id="internal-agent-memory-limit" value={memoryLimit} onChange={(event) => onMemoryLimitChange(event.target.value)} disabled={createPending} />
        </div>
        <div className="space-y-2">
          <label htmlFor="internal-agent-idle-timeout-sec" className="text-sm text-primary">{t('create_dialog.idle_timeout_sec')}</label>
          <Input id="internal-agent-idle-timeout-sec" type="number" min={INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS} value={idleTimeoutSec} onChange={(event) => onIdleTimeoutSecChange(event.target.value)} disabled={createPending} />
        </div>
        <div className="space-y-2">
          <label htmlFor="internal-agent-max-lifetime-sec" className="text-sm text-primary">{t('create_dialog.max_lifetime_sec')}</label>
          <Input id="internal-agent-max-lifetime-sec" type="number" min={INTERNAL_AGENT_MAX_LIFETIME_MIN_SECONDS} value={maxLifetimeSec} onChange={(event) => onMaxLifetimeSecChange(event.target.value)} disabled={createPending} />
        </div>
      </div>
    </div>
  );
}
