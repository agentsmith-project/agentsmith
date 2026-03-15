'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { GroupMemberLike, GroupTemplateOption } from './types';

interface GroupEditorCardProps {
  allPagedSelected: boolean;
  canManage: boolean;
  commonT: (key: string) => string;
  createTemplatePending: boolean;
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
  onCreateTemplate: () => void;
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
  createTemplatePending,
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
  onCreateTemplate,
  onGroupNameChange,
  onMemberPageChange,
  onMemberSearchChange,
  onSave,
  onSelectMember,
  onSelectPage,
  onTemplateIdChange,
}: GroupEditorCardProps) {
  return (
    <div className="space-y-4 rounded-[24px] border border-subtle bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold text-foreground">
          {editingGroupId ? t('edit') : t('create_group')}
        </h4>
        <p className="text-sm leading-6 text-secondary">{t('group_templates_description')}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-tertiary">
            {t('group_name')}
          </label>
          <Input
            value={groupName}
            onChange={(event) => onGroupNameChange(event.target.value)}
            placeholder={t('group_name_placeholder')}
            disabled={!canManage}
            className="bg-surface-high"
            data-testid="members__group-name-input"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label className="block text-xs font-medium uppercase tracking-[0.14em] text-tertiary">
              {t('select_template')}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={!canManage || createTemplatePending}
              onClick={onCreateTemplate}
              data-testid="members__group-create-template-btn"
            >
              {t('create_template')}
            </Button>
          </div>
          <select
            className="h-10 w-full rounded-xl border border-subtle bg-surface-high px-3 text-sm"
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
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-tertiary">{t('select_members')}</p>
            <p className="mt-1 text-sm text-secondary">{t('selected_count', { count: selectedMemberIds.length })}</p>
          </div>
          {typeof selectedTemplatePermissionsCount === 'number' ? (
            <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-tertiary">
              {t('permissions_count', { count: selectedTemplatePermissionsCount })}
            </div>
          ) : null}
        </div>
        <div className="space-y-2 rounded-[20px] border border-subtle bg-surface-high/80 p-3">
          <Input
            value={memberSearch}
            onChange={(event) => onMemberSearchChange(event.target.value)}
            placeholder={membersT('filters.search_placeholder')}
            className="h-9 bg-surface"
            data-testid="members__group-member-search"
          />
          <div className="max-h-48 overflow-auto rounded-[16px] border border-white/6 bg-surface/80 px-2 py-1">
            {pagedMembers.map((member) => (
              <label
                key={member.id}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-xs text-primary transition-colors hover:bg-white/[0.03]"
              >
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
              <p className="px-2 py-4 text-xs text-tertiary">{t('group_empty')}</p>
            ) : null}
          </div>
          <div className="flex items-center justify-between text-xs text-tertiary">
            <span>{filteredMembersCount}</span>
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

      <div className="flex flex-wrap items-center gap-2 border-t border-white/6 pt-1">
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
      </div>
    </div>
  );
}
