'use client';

import { Input } from '@/components/ui/input';

import type { AgentInteractionMode, AgentMode, AgentEndpointOption } from './types';
import { endpointLabel } from './utils';

interface AgentBasicsSectionProps {
  createPending: boolean;
  description: string;
  endpointOptions: AgentEndpointOption[];
  interactionMode: AgentInteractionMode;
  mode: AgentMode;
  name: string;
  notebookEndpointId: string;
  commonT: (key: string) => string;
  t: (key: string) => string;
  onDescriptionChange: (value: string) => void;
  onInteractionModeChange: (value: AgentInteractionMode) => void;
  onModeChange: (value: AgentMode) => void;
  onNameChange: (value: string) => void;
  onNotebookEndpointIdChange: (value: string) => void;
}

export function AgentBasicsSection({
  createPending,
  description,
  endpointOptions,
  interactionMode,
  mode,
  name,
  notebookEndpointId,
  commonT,
  t,
  onDescriptionChange,
  onInteractionModeChange,
  onModeChange,
  onNameChange,
  onNotebookEndpointIdChange,
}: AgentBasicsSectionProps) {
  return (
    <>
      <div className="space-y-2">
        <label htmlFor="agent-name" className="text-sm font-medium text-foreground">
          {t('create_dialog.name')}
        </label>
        <Input
          id="agent-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t('create_dialog.name_placeholder')}
          disabled={createPending}
          required
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="agent-description" className="text-sm font-medium text-foreground">
          {t('create_dialog.description')}
        </label>
        <textarea
          id="agent-description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder={commonT('placeholders.enter_description')}
          rows={2}
          disabled={createPending}
          className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('create_dialog.mode')}</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="external"
              checked={mode === 'external'}
              onChange={() => onModeChange('external')}
              disabled={createPending}
              className="rounded-full border-subtle"
            />
            <span className="text-sm">{t('create_dialog.mode_external')}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="internal"
              checked={mode === 'internal'}
              onChange={() => onModeChange('internal')}
              disabled={createPending}
              className="rounded-full border-subtle"
            />
            <span className="text-sm">{t('create_dialog.mode_internal')}</span>
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('create_dialog.interaction_mode')}</label>
        <select
          value={interactionMode}
          onChange={(event) => onInteractionModeChange(event.target.value as AgentInteractionMode)}
          disabled={createPending}
          className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <option value="chat">{t('interaction_chat')}</option>
          <option value="notebook">{t('interaction_notebook')}</option>
          <option value="both">{t('interaction_both')}</option>
        </select>
      </div>

      {mode === 'external' && (interactionMode === 'notebook' || interactionMode === 'both') ? (
        <div className="space-y-2">
          <label htmlFor="notebook-endpoint-id" className="text-sm font-medium text-foreground">
            {t('create_dialog.notebook_endpoint_id')}
          </label>
          <select
            id="notebook-endpoint-id"
            value={notebookEndpointId}
            onChange={(event) => onNotebookEndpointIdChange(event.target.value)}
            disabled={createPending}
            className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            {endpointOptions.length === 0 ? <option value="">{t('create_dialog.notebook_endpoint_empty')}</option> : null}
            {endpointOptions.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpointLabel(endpoint)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}
