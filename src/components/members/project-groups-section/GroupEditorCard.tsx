'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { GroupMemberLike, GroupTemplateOption } from './types';

interface GroupEditorCardProps {
  allPagedSelected: boolean;
  canManage: boolean;
  commonT: (key: string) => string;
  createPending: boolean;
  editingGroupId: string | null;
  filteredMembersCount: number;
  groupName: string;
  hasAnyPagedSelected: boolean;
  memberPage: number;
  memberPageCount: number;
  memberSearch: string;
  membersT: (key: string) => string;
  pagedMembers: GroupMemberLike[];
  selectedMemberIds: string[];
  selectedTemplatePermissionsCount?: number;
  selectedTemplateId: string;
  templateOptions: GroupTemplateOption[];
  t: (key: string, values?: Record<string, string | number>) => string;
  updatePending: boolean;
  onCancelEdit: () => void;
  onClearPage: () => void;
  onGroupNameChange: (value: string) => void;
  onMemberPageChange: (nextPage: number) => void;
  onMemberSearchChange: (value: string) => void;
  onSave: () => void;
  onSelectMember: (memberId: string) => void;
  onSelectPage: () => void;
  onTemplateIdChange: (value: string) => void;
}

export function GroupEditorCard({
  allPagedSelected,
  canManage,
  commonT,
  createPending,
  editingGroupId,
  filteredMembersCount,
  groupName,
  hasAnyPagedSelected,
  memberPage,
  memberPageCount,
  memberSearch,
  membersT,
  pagedMembers,
  selectedMemberIds,
  selectedTemplatePermissionsCount,
  selectedTemplateId,
  templateOptions,
  t,
  updatePending,
  onCancelEdit,
  onClearPage,
  onGroupNameChange,
  onMemberPageChange,
  onMemberSearchChange,
  onSave,
  onSelectMember,
  onSelectPage,
  onTemplateIdChange,
}: GroupEditorCardProps) {
  return (
    <div className="rounded-md border border-subtle bg-surface p-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-tertiary">{t('group_name')}</label>
          <Input
            value={groupName}
            onChange={(event) => onGroupNameChange(event.target.value)}
            placeholder={t('group_name_placeholder')}
            disabled={!canManage}
            data-testid="members__group-name-input"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-tertiary">{t('select_template')}</label>
          <select
            className="h-10 w-full rounded-md border border-subtle bg-surface-high px-3 text-sm"
            value={selectedTemplateId}
            onChange={(event) => onTemplateIdChange(event.target.value)}
            disabled={!canManage}
            data-testid="members__group-template-select"
          >
            <option value="">{t('select_template')}</option>
            {templateOptions.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-tertiary">{t('select_members')}</p>
        <div className="space-y-2 rounded-sm border border-subtle bg-surface-high p-2">
          <Input
            value={memberSearch}
            onChange={(event) => onMemberSearchChange(event.target.value)}
            placeholder={membersT('filters.search_placeholder')}
            className="h-8 bg-surface"
            data-testid="members__group-member-search"
          />
          <div className="max-h-44 overflow-auto">
            {pagedMembers.map((member) => (
              <label key={member.id} className="flex items-center gap-2 py-1 text-xs text-primary">
                <input
                  type="checkbox"
                  checked={selectedMemberIds.includes(member.id)}
                  onChange={() => onSelectMember(member.id)}
                  disabled={!canManage}
                  data-testid={`members__group-member-checkbox--${member.id}`}
                />
                {member.name || member.email}
              </label>
            ))}
            {pagedMembers.length === 0 ? (
              <p className="px-1 py-3 text-xs text-tertiary">{t('group_empty')}</p>
            ) : null}
          </div>
          <div className="flex items-center justify-between text-xs text-tertiary">
            <span>{t('selected_count', { count: selectedMemberIds.length })}</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                disabled={!canManage || allPagedSelected || pagedMembers.length === 0}
                onClick={onSelectPage}
                data-testid="members__group-member-select-page"
              >
                {t('select_all')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                disabled={!canManage || !hasAnyPagedSelected}
                onClick={onClearPage}
                data-testid="members__group-member-clear-page"
              >
                {t('deselect_all')}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-tertiary">
            <span>
              {memberPage}/{memberPageCount} · {filteredMembersCount}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                disabled={memberPage <= 1}
                onClick={() => onMemberPageChange(Math.max(1, memberPage - 1))}
                data-testid="members__group-member-page-prev"
              >
                {commonT('previous')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                disabled={memberPage >= memberPageCount}
                onClick={() => onMemberPageChange(Math.min(memberPageCount, memberPage + 1))}
                data-testid="members__group-member-page-next"
              >
                {commonT('next')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={onSave}
          disabled={!canManage || !groupName.trim() || !selectedTemplateId || createPending || updatePending}
          data-testid="members__group-save-btn"
        >
          {editingGroupId ? t('save_changes') : t('create_group')}
        </Button>
        {editingGroupId ? (
          <Button type="button" variant="ghost" onClick={onCancelEdit}>
            {t('cancel')}
          </Button>
        ) : null}
        {typeof selectedTemplatePermissionsCount === 'number' ? (
          <span className="text-xs text-tertiary">
            {t('permissions_count', { count: selectedTemplatePermissionsCount })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
