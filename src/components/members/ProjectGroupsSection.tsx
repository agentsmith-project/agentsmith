'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';
import {
  useApplyProjectGroupTemplate,
  useCreateProjectGroup,
  useDeleteProjectGroup,
  useMembers,
  usePermissionTemplates,
  useProjectGroups,
  useUpdateProjectGroup,
} from '@/lib/hooks/use-members';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';
import type { ProjectGroup } from '@/lib/api/endpoints/members';
import { toast } from '@/components/ui/toast';

type PreviewDiff = {
  memberId: string;
  memberName: string;
  addCount: number;
  removeCount: number;
};

export interface ProjectGroupsSectionProps {
  workspaceId: string;
  projectId: string;
}

export function ProjectGroupsSection({ workspaceId, projectId }: ProjectGroupsSectionProps) {
  const t = useTranslations('members.templates');
  const membersT = useTranslations('members');
  const canManage = useCanManageMemberGovernance();
  const { data: groups = [] } = useProjectGroups(workspaceId, projectId);
  const { data: members = [], refetch: refetchMembers } = useMembers(workspaceId, projectId);
  const { data: templates = [] } = usePermissionTemplates(workspaceId, projectId);
  const createGroup = useCreateProjectGroup(workspaceId, projectId);
  const updateGroup = useUpdateProjectGroup(workspaceId, projectId);
  const deleteGroup = useDeleteProjectGroup(workspaceId, projectId);
  const applyGroupTemplate = useApplyProjectGroupTemplate(workspaceId, projectId);

  const [name, setName] = React.useState('');
  const [templateId, setTemplateId] = React.useState('');
  const [selectedMemberIds, setSelectedMemberIds] = React.useState<string[]>([]);
  const [memberSearch, setMemberSearch] = React.useState('');
  const [memberPage, setMemberPage] = React.useState(1);
  const [editingGroupId, setEditingGroupId] = React.useState<string | null>(null);
  const [previewGroupId, setPreviewGroupId] = React.useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = React.useState<ProjectGroup | null>(null);
  const [lastApplyResult, setLastApplyResult] = React.useState<{
    groupId: string;
    appliedCount: number;
    failedMemberIds: string[];
    failedDetails: Array<{ memberId: string; message?: string }>;
  } | null>(null);

  const defaultTemplates = React.useMemo(
    () => [
      { id: 'owner', name: t('default_templates.owner'), permissions: [...ROLE_TEMPLATES.owner], is_default: true },
      { id: 'admin', name: t('default_templates.admin'), permissions: [...ROLE_TEMPLATES.admin], is_default: true },
      { id: 'developer', name: t('default_templates.developer'), permissions: [...ROLE_TEMPLATES.developer], is_default: true },
      { id: 'user', name: t('default_templates.user'), permissions: [...ROLE_TEMPLATES.user], is_default: true },
    ],
    [t]
  );

  const templateOptions = React.useMemo(() => {
    const deduped = new Map<string, { id: string; name: string; permissions: string[]; is_default?: boolean }>();
    for (const template of defaultTemplates) deduped.set(template.id, template);
    for (const template of templates) {
      if (!deduped.has(template.id)) deduped.set(template.id, template);
    }
    return Array.from(deduped.values());
  }, [defaultTemplates, templates]);

  const selectedTemplate = templateOptions.find((tpl) => tpl.id === templateId);
  const filteredMembers = React.useMemo(() => {
    const keyword = memberSearch.trim().toLowerCase();
    if (!keyword) return members;
    return members.filter((member) => {
      const name = member.name?.toLowerCase() ?? '';
      const email = member.email.toLowerCase();
      return name.includes(keyword) || email.includes(keyword);
    });
  }, [memberSearch, members]);
  const memberPageSize = 8;
  const memberPageCount = Math.max(1, Math.ceil(filteredMembers.length / memberPageSize));
  const pagedMembers = React.useMemo(() => {
    const start = (memberPage - 1) * memberPageSize;
    return filteredMembers.slice(start, start + memberPageSize);
  }, [filteredMembers, memberPage]);

  const toggleMember = (memberId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    );
  };

  const resetForm = () => {
    setName('');
    setTemplateId('');
    setSelectedMemberIds([]);
    setMemberSearch('');
    setMemberPage(1);
    setEditingGroupId(null);
  };

  const handleSaveGroup = async () => {
    if (!name.trim() || !templateId) return;
    if (editingGroupId) {
      await updateGroup.mutateAsync({
        groupId: editingGroupId,
        data: {
          name: name.trim(),
          permission_template_id: templateId,
          member_ids: selectedMemberIds,
        },
      });
    } else {
      await createGroup.mutateAsync({
        name: name.trim(),
        permission_template_id: templateId,
        member_ids: selectedMemberIds,
      });
    }
    resetForm();
  };

  const startEdit = (group: {
    id: string;
    name: string;
    permission_template_id: string;
    member_ids: string[];
  }) => {
    setEditingGroupId(group.id);
    setName(group.name);
    setTemplateId(group.permission_template_id);
    setSelectedMemberIds(group.member_ids);
    setMemberPage(1);
  };

  React.useEffect(() => {
    if (memberPage > memberPageCount) {
      setMemberPage(memberPageCount);
    }
  }, [memberPage, memberPageCount]);

  const templateNameMap = new Map(templateOptions.map((tpl) => [tpl.id, tpl.name]));
  const memberNameMap = new Map(
    members.map((member) => [member.id, member.name || member.email || member.id])
  );

  const getTemplatePermissions = React.useCallback(
    (templateIdValue: string): string[] => {
      const custom = templateOptions.find((template) => template.id === templateIdValue);
      if (custom) return custom.permissions;
      const roleKey = templateIdValue as keyof typeof ROLE_TEMPLATES;
      return roleKey in ROLE_TEMPLATES ? [...ROLE_TEMPLATES[roleKey]] : [];
    },
    [templateOptions],
  );

  const previewDiffs = React.useMemo<PreviewDiff[]>(() => {
    if (!previewGroupId) return [];
    const group = groups.find((item) => item.id === previewGroupId);
    if (!group) return [];
    const memberNameMap = new Map(members.map((member) => [member.id, member.name || member.email || member.id]));
    const templatePermissions = new Set(getTemplatePermissions(group.permission_template_id));
    return group.member_ids.map((memberId) => {
      const member = members.find((item) => item.id === memberId);
      const currentPermissions = new Set(member?.permissions ?? []);
      let addCount = 0;
      let removeCount = 0;
      for (const permission of templatePermissions) {
        if (!currentPermissions.has(permission)) addCount += 1;
      }
      for (const permission of currentPermissions) {
        if (!templatePermissions.has(permission)) removeCount += 1;
      }
      return {
        memberId,
        memberName: memberNameMap.get(memberId) ?? memberId,
        addCount,
        removeCount,
      };
    });
  }, [getTemplatePermissions, groups, members, previewGroupId]);

  const handleApplyGroup = async (group: ProjectGroup) => {
    const result = await applyGroupTemplate.mutateAsync({ groupId: group.id });
    const failedItems = (result.results ?? []).filter((item) => item.status === 'failed');
    const failedMemberIds = failedItems.map((item) => item.member_id);
    setLastApplyResult({
      groupId: group.id,
      appliedCount: result.applied_count,
      failedMemberIds,
      failedDetails: failedItems.map((item) => ({ memberId: item.member_id, message: item.message })),
    });
    await refetchMembers();
  };

  const handleRetryFailed = async (groupId: string, failedMemberIds: string[]) => {
    if (failedMemberIds.length === 0) return;
    const result = await applyGroupTemplate.mutateAsync({ groupId, memberIds: failedMemberIds });
    const failedItems = (result.results ?? []).filter((item) => item.status === 'failed');
    setLastApplyResult({
      groupId,
      appliedCount: result.applied_count,
      failedMemberIds: failedItems.map((item) => item.member_id),
      failedDetails: failedItems.map((item) => ({ memberId: item.member_id, message: item.message })),
    });
    await refetchMembers();
  };

  const buildFailedListText = (groupId: string) => {
    if (!lastApplyResult || lastApplyResult.groupId !== groupId) return '';
    return lastApplyResult.failedDetails
      .map((item) => `${item.memberId},${memberNameMap.get(item.memberId) ?? item.memberId},${item.message ?? ''}`)
      .join('\n');
  };

  const handleCopyFailedList = async (groupId: string) => {
    const text = buildFailedListText(groupId);
    if (!text) return;
    await navigator.clipboard.writeText(`member_id,member_name,reason\n${text}`);
    toast.success(t('copy_failed_members_success'));
  };

  const handleExportFailedList = (groupId: string) => {
    const text = buildFailedListText(groupId);
    if (!text) return;
    const blob = new Blob([`member_id,member_name,reason\n${text}\n`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `group-${groupId}-failed-members.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5" data-testid="members__groups-section">
      <div>
        <h3 className="text-sm font-medium text-foreground">{t('group_templates')}</h3>
        <p className="mt-1 text-xs text-tertiary">{t('group_templates_description')}</p>
      </div>

      <div className="rounded-md border border-subtle bg-surface p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-tertiary">{t('group_name')}</label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('group_name_placeholder')}
              disabled={!canManage}
              data-testid="members__group-name-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-tertiary">{t('select_template')}</label>
            <select
              className="h-10 w-full rounded-md border border-subtle bg-surface-high px-3 text-sm"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
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
              onChange={(event) => {
                setMemberSearch(event.target.value);
                setMemberPage(1);
              }}
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
                  onChange={() => toggleMember(member.id)}
                  disabled={!canManage}
                  data-testid={`members__group-member-checkbox--${member.id}`}
                />
                {member.name || member.email}
              </label>
              ))}
              {pagedMembers.length === 0 && (
                <p className="px-1 py-3 text-xs text-tertiary">{t('group_empty')}</p>
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-tertiary">
              <span>{memberPage}/{memberPageCount}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  disabled={memberPage <= 1}
                  onClick={() => setMemberPage((prev) => Math.max(1, prev - 1))}
                  data-testid="members__group-member-page-prev"
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  disabled={memberPage >= memberPageCount}
                  onClick={() => setMemberPage((prev) => Math.min(memberPageCount, prev + 1))}
                  data-testid="members__group-member-page-next"
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => {
              void handleSaveGroup();
            }}
            disabled={!canManage || !name.trim() || !templateId || createGroup.isPending || updateGroup.isPending}
            data-testid="members__group-save-btn"
          >
            {editingGroupId ? t('save_changes') : t('create_group')}
          </Button>
          {editingGroupId && (
            <Button type="button" variant="ghost" onClick={resetForm}>
              {t('cancel')}
            </Button>
          )}
          {selectedTemplate && (
            <span className="text-xs text-tertiary">
              {t('permissions_count', { count: selectedTemplate.permissions.length })}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {groups.length === 0 ? (
          <div className="rounded-md border border-dashed border-subtle p-4 text-xs text-tertiary">
            {t('group_empty')}
          </div>
        ) : (
          groups.map((group) => (
            <div
              key={group.id}
              className="rounded-md border border-subtle bg-surface p-3"
              data-testid={`members__group-row--${group.id}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-primary">{group.name}</p>
                  <p className="text-xs text-tertiary">
                    {templateNameMap.get(group.permission_template_id) || group.permission_template_id}
                    {' · '}
                    {t('selected_count', { count: group.member_ids.length })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canManage || applyGroupTemplate.isPending}
                    onClick={() => {
                      void handleApplyGroup(group);
                    }}
                    data-testid={`members__group-apply-btn--${group.id}`}
                  >
                    {t('apply_to_members')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewGroupId(previewGroupId === group.id ? null : group.id)}
                    data-testid={`members__group-preview-btn--${group.id}`}
                  >
                    {t('preview_changes')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canManage}
                    onClick={() => startEdit(group)}
                    data-testid={`members__group-edit-btn--${group.id}`}
                  >
                    {t('edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canManage || deleteGroup.isPending}
                    onClick={() => setGroupToDelete(group)}
                    data-testid={`members__group-delete-btn--${group.id}`}
                  >
                    {t('delete')}
                  </Button>
                </div>
              </div>
              {previewGroupId === group.id && (
                <div className="mt-3 rounded-sm border border-subtle bg-surface-high p-3">
                  <p className="mb-2 text-xs text-tertiary">{t('group_preview_title')}</p>
                  <div className="space-y-1">
                    {previewDiffs.length === 0 ? (
                      <p className="text-xs text-tertiary">{t('group_preview_empty')}</p>
                    ) : (
                      previewDiffs.map((diff) => (
                        <div
                          key={diff.memberId}
                          className="flex items-center justify-between text-xs"
                          data-testid={`members__group-preview-row--${group.id}--${diff.memberId}`}
                        >
                          <span className="text-primary">{diff.memberName}</span>
                          <span className="text-tertiary">
                            +{diff.addCount} / -{diff.removeCount}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              {lastApplyResult?.groupId === group.id && (
                <div className="mt-2 rounded-sm border border-subtle bg-surface-high p-2 text-xs text-tertiary">
                  <p data-testid={`members__group-apply-result--${group.id}`}>
                    {t('group_apply_result', {
                      applied: lastApplyResult.appliedCount,
                      failed: lastApplyResult.failedMemberIds.length,
                    })}
                  </p>
                  {lastApplyResult.failedDetails.length > 0 && (
                    <div className="mt-2 space-y-1" data-testid={`members__group-apply-failed-list--${group.id}`}>
                      {lastApplyResult.failedDetails.map((item) => (
                        <p key={item.memberId}>
                          {(memberNameMap.get(item.memberId) ?? item.memberId)}
                          {item.message ? ` (${item.message})` : ''}
                        </p>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void handleRetryFailed(group.id, lastApplyResult.failedMemberIds);
                        }}
                        disabled={applyGroupTemplate.isPending}
                        data-testid={`members__group-retry-failed-btn--${group.id}`}
                      >
                        {t('retry_failed_members')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void handleCopyFailedList(group.id);
                        }}
                        data-testid={`members__group-copy-failed-btn--${group.id}`}
                      >
                        {t('copy_failed_members')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleExportFailedList(group.id)}
                        data-testid={`members__group-export-failed-btn--${group.id}`}
                      >
                        {t('export_failed_members')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <AlertDialog
        open={!!groupToDelete}
        onOpenChange={(open) => {
          if (!open) setGroupToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('group_delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {groupToDelete ? t('group_delete_confirm_message', { name: groupToDelete.name }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!groupToDelete) return;
                void deleteGroup.mutateAsync(groupToDelete.id);
                setGroupToDelete(null);
              }}
              disabled={deleteGroup.isPending}
              data-testid="members__group-delete-confirm-btn"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
