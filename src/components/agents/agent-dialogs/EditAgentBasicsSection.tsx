'use client';

import { Input } from '@/components/ui/input';

import type { Agent } from '@/lib/api/types';

import type { AgentEndpointOption, AgentInteractionMode } from './types';
import { endpointLabel } from './utils';

interface EditAgentBasicsSectionProps {
  agent: Agent;
  canSetVisibility: boolean;
  commonT: (key: string) => string;
  description: string;
  endpointOptions: AgentEndpointOption[];
  interactionMode: AgentInteractionMode;
  name: string;
  notebookEndpointId: string;
  pending: boolean;
  t: (key: string) => string;
  visibility: 'private' | 'public';
  onDescriptionChange: (value: string) => void;
  onInteractionModeChange: (value: AgentInteractionMode) => void;
  onNameChange: (value: string) => void;
  onNotebookEndpointIdChange: (value: string) => void;
  onVisibilityChange: (value: 'private' | 'public') => void;
}

export function EditAgentBasicsSection({
  agent,
  canSetVisibility,
  commonT,
  description,
  endpointOptions,
  interactionMode,
  name,
  notebookEndpointId,
  pending,
  t,
  visibility,
  onDescriptionChange,
  onInteractionModeChange,
  onNameChange,
  onNotebookEndpointIdChange,
  onVisibilityChange,
}: EditAgentBasicsSectionProps) {
  return (
    <>
      <div className="space-y-2">
        <label htmlFor="edit-agent-name" className="text-sm font-medium text-foreground">
          {t('create_dialog.name')}
        </label>
        <Input
          id="edit-agent-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t('create_dialog.name_placeholder')}
          disabled={pending}
          required
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="edit-agent-description" className="text-sm font-medium text-foreground">
          {t('create_dialog.description')}
        </label>
        <textarea
          id="edit-agent-description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder={commonT('placeholders.enter_description')}
          rows={2}
          disabled={pending}
          className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('create_dialog.mode')}</label>
        <div className="px-3 py-2 rounded-sm border border-subtle bg-surface-low text-primary text-sm capitalize">
          {agent.mode}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{commonT('visibility')}</label>
        <select
          value={visibility}
          onChange={(event) => onVisibilityChange(event.target.value as 'private' | 'public')}
          disabled={pending || !canSetVisibility}
          className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-70"
        >
          <option value="private">{commonT('private')}</option>
          <option value="public">{commonT('public')}</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('create_dialog.interaction_mode')}</label>
        <select
          value={interactionMode}
          onChange={(event) => onInteractionModeChange(event.target.value as AgentInteractionMode)}
          disabled={pending}
          className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <option value="chat">{t('interaction_chat')}</option>
          <option value="notebook">{t('interaction_notebook')}</option>
          <option value="both">{t('interaction_both')}</option>
        </select>
      </div>

      {agent.mode === 'external' && (interactionMode === 'notebook' || interactionMode === 'both') ? (
        <div className="space-y-2">
          <label htmlFor="edit-notebook-endpoint-id" className="text-sm font-medium text-foreground">
            {t('create_dialog.notebook_endpoint_id')}
          </label>
          <select
            id="edit-notebook-endpoint-id"
            value={notebookEndpointId}
            onChange={(event) => onNotebookEndpointIdChange(event.target.value)}
            disabled={pending}
            className="w-full px-3 py-2.5 rounded-md border border-border-input bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            {endpointOptions.length === 0 ? (
              <option value="">{t('create_dialog.notebook_endpoint_empty')}</option>
            ) : null}
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
