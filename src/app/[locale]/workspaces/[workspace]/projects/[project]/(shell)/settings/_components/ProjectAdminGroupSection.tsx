'use client';

import Link from 'next/link';
import { Loader2, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import type { SettingsProjectAdminOption } from '../settings-page-types';

interface ProjectAdminGroupSectionProps {
  canAssignProjectAdmins: boolean;
  savingProjectAdmins: boolean;
  selectedProjectAdmins: string[];
  settingsT: (key: string) => string;
  workspaceMembers: SettingsProjectAdminOption[];
  membersHref: string;
  onCheckedChange: (userId: string, checked: boolean) => void;
  onSave: () => void;
}

export function ProjectAdminGroupSection({
  canAssignProjectAdmins,
  savingProjectAdmins,
  selectedProjectAdmins,
  settingsT,
  workspaceMembers,
  membersHref,
  onCheckedChange,
  onSave,
}: ProjectAdminGroupSectionProps) {
  return (
    <section className="space-y-4 py-5" data-testid="settings__project-admins-section">
      <div className="flex flex-wrap items-start justify-between gap-3" data-testid="settings__project-admins-header">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{settingsT('admin_group_title')}</h3>
          <p className="text-sm text-tertiary">
          {canAssignProjectAdmins ? settingsT('admin_group_owner_help') : settingsT('admin_group_read_only_help')}
          </p>
        </div>
        {canAssignProjectAdmins ? (
          <Button
            onClick={onSave}
            disabled={savingProjectAdmins}
            variant="primary"
            className="shrink-0"
            data-testid="settings__project-admins-save"
          >
            {savingProjectAdmins ? <Loader2 className="w-4 h-4 animate-spin" /> : settingsT('admin_group_save')}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">
            {settingsT('admin_group_members_flow_label')}
          </p>
          <p className="text-sm text-secondary">{settingsT('admin_group_members_flow_help')}</p>
        </div>
        <Link
          href={membersHref}
          className="text-sm font-medium text-secondary underline-offset-2 hover:text-foreground hover:underline"
          data-testid="settings__project-admins-open-members"
        >
          {settingsT('admin_group_open_members')}
        </Link>
      </div>
      <div className="divide-y divide-subtle/60">
        {workspaceMembers.map((member) => {
          const label = member.name || member.email || member.user_id;
          const description = member.email || member.user_id;
          const checked = selectedProjectAdmins.includes(member.user_id);
          return (
            <label
              key={member.id}
              htmlFor={`project-admin-${member.user_id}`}
              className="flex items-start gap-3 py-3"
              data-testid={`settings__project-admin-option--${member.user_id}`}
            >
              <Checkbox
                id={`project-admin-${member.user_id}`}
                checked={checked}
                onCheckedChange={(value) => onCheckedChange(member.user_id, value === true)}
                disabled={!canAssignProjectAdmins || savingProjectAdmins}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users className="h-4 w-4 text-icon-default" />
                  {label}
                </div>
                <div className="text-xs text-tertiary">{description}</div>
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
}
