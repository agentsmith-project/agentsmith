'use client';

import { Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface GeneralSettingsSectionProps {
  canManageProjectLifecycle: boolean;
  commonT: (key: string) => string;
  description: string;
  joinPolicy: 'approval_required' | 'open';
  name: string;
  projectT: (key: string) => string;
  savingGeneral: boolean;
  settingsT: (key: string) => string;
  visibility: 'public' | 'private';
  onDescriptionChange: (value: string) => void;
  onJoinPolicyChange: (value: 'approval_required' | 'open') => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
  onVisibilityChange: (value: 'public' | 'private') => void;
}

export function GeneralSettingsSection({
  canManageProjectLifecycle,
  commonT,
  description,
  joinPolicy,
  name,
  projectT,
  savingGeneral,
  settingsT,
  visibility,
  onDescriptionChange,
  onJoinPolicyChange,
  onNameChange,
  onSave,
  onVisibilityChange,
}: GeneralSettingsSectionProps) {
  return (
    <div className="rounded-lg border border-subtle bg-bg-base/20 p-4" data-testid="settings__general-section">
      <h3 className="text-sm font-semibold text-foreground mb-1">{settingsT('general_access_title')}</h3>
      <p className="text-sm text-tertiary mb-4">
        {canManageProjectLifecycle ? settingsT('general_help') : settingsT('general_read_only_help')}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-1">
          <label className="block text-sm font-medium text-primary mb-2">{settingsT('project_name')}</label>
          <Input value={name} onChange={(event) => onNameChange(event.target.value)} disabled={!canManageProjectLifecycle} />
        </div>
        <div className="md:col-span-1">
          <label className="block text-sm font-medium text-primary mb-2">{settingsT('visibility')}</label>
          <Select
            value={visibility}
            onValueChange={(value) => onVisibilityChange(value as 'public' | 'private')}
            disabled={!canManageProjectLifecycle}
          >
            <SelectTrigger data-testid="settings__visibility-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">{projectT('public')}</SelectItem>
              <SelectItem value="private">{projectT('private')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-primary mb-2">{settingsT('description')}</label>
          <Textarea
            placeholder="Add a description..."
            rows={3}
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            disabled={!canManageProjectLifecycle}
          />
        </div>
        <div className="md:col-span-1">
          <label className="block text-sm font-medium text-primary mb-2">{settingsT('join_policy')}</label>
          <Select
            value={joinPolicy}
            onValueChange={(value) => onJoinPolicyChange(value as 'approval_required' | 'open')}
            disabled={!canManageProjectLifecycle}
          >
            <SelectTrigger data-testid="settings__join-policy-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approval_required">{projectT('approval_required')}</SelectItem>
              <SelectItem value="open">{projectT('open')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <Button onClick={onSave} disabled={!canManageProjectLifecycle || savingGeneral} variant="primary" data-testid="settings__save-btn">
          <Save className="w-4 h-4" />
          {savingGeneral ? 'Saving...' : commonT('save')}
        </Button>
      </div>
    </div>
  );
}
