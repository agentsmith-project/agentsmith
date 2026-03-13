'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { SettingsProject, SettingsWorkspaceMember } from '../settings-page-types';

interface ProjectOwnerSectionProps {
  canTransferProjectOwner: boolean;
  currentProject: SettingsProject;
  savingProjectOwner: boolean;
  selectedProjectOwner: string;
  settingsT: (key: string) => string;
  workspaceMembers: SettingsWorkspaceMember[];
  onOwnerChange: (value: string) => void;
  onSave: () => void;
}

export function ProjectOwnerSection({
  canTransferProjectOwner,
  currentProject,
  savingProjectOwner,
  selectedProjectOwner,
  settingsT,
  workspaceMembers,
  onOwnerChange,
  onSave,
}: ProjectOwnerSectionProps) {
  return (
    <div className="rounded-lg border border-subtle bg-bg-base/20 p-4" data-testid="settings__project-owner-section">
      <h3 className="text-sm font-semibold text-foreground mb-1">{settingsT('project_owner_title')}</h3>
      <p className="text-sm text-tertiary mb-4">
        {canTransferProjectOwner ? settingsT('project_owner_help') : settingsT('project_owner_read_only_help')}
      </p>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-primary" htmlFor="project-owner-select">
          {settingsT('project_owner_field')}
        </label>
        <select
          id="project-owner-select"
          value={selectedProjectOwner}
          onChange={(event) => onOwnerChange(event.target.value)}
          disabled={!canTransferProjectOwner || savingProjectOwner}
          className="w-full rounded-sm border border-subtle bg-surface px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="settings__project-owner-select"
        >
          {workspaceMembers.map((member) => (
            <option key={member.id} value={member.user_id}>
              {member.name || member.email || member.user_id}
            </option>
          ))}
        </select>
      </div>
      {canTransferProjectOwner ? (
        <div className="mt-6 flex justify-end">
          <Button
            onClick={onSave}
            disabled={savingProjectOwner || selectedProjectOwner === currentProject.owner_id}
            variant="primary"
            data-testid="settings__project-owner-save"
          >
            {savingProjectOwner ? <Loader2 className="w-4 h-4 animate-spin" /> : settingsT('project_owner_save')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
