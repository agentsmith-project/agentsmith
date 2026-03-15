'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
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
import {
  useCreatePermissionTemplate,
  useApplyProjectGroupTemplate,
  useCreateProjectGroup,
  useDeleteProjectGroup,
  useMembers,
  usePermissionTemplates,
  useProjectGroups,
  useUpdatePermissionTemplate,
  useUpdateProjectGroup,
} from '@/lib/hooks/use-members';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';
import type { ProjectGroup } from '@/lib/api/endpoints/members';
import type { PermissionTemplate } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { GroupEditorCard } from './project-groups-section/GroupEditorCard';
import { GroupList } from './project-groups-section/GroupList';
import { CreateTemplateDrawer } from './CreateTemplateDrawer';
import { EditTemplateDrawer } from './EditTemplateDrawer';
import type { PreviewDiff } from './project-groups-section/types';
import {
  buildDefaultTemplates,
  buildFailedListText as buildFailedListCsvText,
  buildPreviewDiffs,
  buildTemplateOptions,
} from './project-groups-section/utils';

export interface ProjectGroupsSectionProps {
  workspaceId: string;
  projectId: string;
}

export function ProjectGroupsSection({ workspaceId, projectId }: ProjectGroupsSectionProps) {
  const t = useTranslations('members.templates');
  const membersT = useTranslations('members');
  const commonT = useTranslations('common');
  const canManage = useCanManageMemberGovernance();
  const { data: groups = [] } = useProjectGroups(workspaceId, projectId);
  const { data: members = [], refetch: refetchMembers } = useMembers(workspaceId, projectId);
  const { data: templates = [] } = usePermissionTemplates(workspaceId, projectId);
  const createPermissionTemplate = useCreatePermissionTemplate(workspaceId, projectId);
  const createGroup = useCreateProjectGroup(workspaceId, projectId);
  const updateGroup = useUpdateProjectGroup(workspaceId, projectId);
  const deleteGroup = useDeleteProjectGroup(workspaceId, projectId);
  const applyGroupTemplate = useApplyProjectGroupTemplate(workspaceId, projectId);

  const [name, setName] = React.useState('');
  const [templateId, setTemplateId] = React.useState<string>('user');
  const [selectedMemberIds, setSelectedMemberIds] = React.useState<string[]>([]);
  const [inlineTemplates, setInlineTemplates] = React.useState<PermissionTemplate[]>([]);
  const [memberSearch, setMemberSearch] = React.useState('');
  const [memberPage, setMemberPage] = React.useState(1);
  const [editingGroupId, setEditingGroupId] = React.useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = React.useState<string | null>(null);
  const [previewGroupId, setPreviewGroupId] = React.useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = React.useState<ProjectGroup | null>(null);
  const [createTemplateOpen, setCreateTemplateOpen] = React.useState(false);
  const [editTemplateOpen, setEditTemplateOpen] = React.useState(false);
  const [lastApplyResult, setLastApplyResult] = React.useState<{
    groupId: string;
    appliedCount: number;
    failedMemberIds: string[];
    failedDetails: Array<{ memberId: string; message?: string }>;
  } | null>(null);
  const editorCardRef = React.useRef<HTMLDivElement | null>(null);
  const groupNameInputRef = React.useRef<HTMLInputElement | null>(null);
  const updatePermissionTemplate = useUpdatePermissionTemplate(workspaceId, projectId, templateId);

  const defaultTemplates = React.useMemo(
    () => buildDefaultTemplates(t),
    [t]
  );

  const templateOptions = React.useMemo(() => {
    return buildTemplateOptions(defaultTemplates, [...templates, ...inlineTemplates]);
  }, [defaultTemplates, inlineTemplates, templates]);

  const selectedTemplatePermissionsCount =
    templateOptions.find((template) => template.id === templateId)?.permissions.length ?? 0;
  const selectedTemplate = React.useMemo(
    () => templateOptions.find((template) => template.id === templateId) ?? null,
    [templateId, templateOptions],
  );
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

  const allPagedMemberIds = React.useMemo(() => pagedMembers.map((member) => member.id), [pagedMembers]);
  const allPagedSelected = allPagedMemberIds.length > 0 && allPagedMemberIds.every((id) => selectedMemberIds.includes(id));
  const hasAnyPagedSelected = allPagedMemberIds.some((id) => selectedMemberIds.includes(id));

  const selectAllPagedMembers = () => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      for (const memberId of allPagedMemberIds) next.add(memberId);
      return Array.from(next);
    });
  };

  const deselectAllPagedMembers = () => {
    setSelectedMemberIds((prev) => prev.filter((memberId) => !allPagedMemberIds.includes(memberId)));
  };

  const resetForm = () => {
    setName('');
    setTemplateId('user');
    setSelectedMemberIds([]);
    setMemberSearch('');
    setMemberPage(1);
    setEditingGroupId(null);
    setEditingGroupName(null);
    setPreviewGroupId(null);
    setLastApplyResult(null);
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
    setEditingGroupName(group.name);
    setName(group.name);
    setTemplateId(group.permission_template_id);
    setSelectedMemberIds(group.member_ids);
    setMemberPage(1);
    requestAnimationFrame(() => {
      if (typeof editorCardRef.current?.scrollIntoView === 'function') {
        editorCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      requestAnimationFrame(() => {
        groupNameInputRef.current?.focus();
        groupNameInputRef.current?.select();
      });
    });
  };

  const handleCreateTemplate = async (data: {
    name: string;
    description?: string;
    permissions: string[];
  }) => {
    const created = await createPermissionTemplate.mutateAsync(data);
    setInlineTemplates((prev) => {
      if (prev.some((template) => template.id === created.id)) {
        return prev;
      }
      return [...prev, created];
    });
    setTemplateId(created.id);
  };

  const handleEditTemplate = async (data: {
    name: string;
    description?: string;
    permissions: string[];
  }) => {
    if (!selectedTemplate || selectedTemplate.is_default) return;
    await updatePermissionTemplate.mutateAsync(data);
    setInlineTemplates((prev) =>
      prev.map((template) =>
        template.id === selectedTemplate.id
          ? {
              ...template,
              name: data.name,
              description: data.description,
              permissions: data.permissions,
            }
          : template,
      ),
    );
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

  const previewDiffs = React.useMemo<PreviewDiff[]>(() => {
    return buildPreviewDiffs(groups, members, previewGroupId, templateOptions);
  }, [groups, members, previewGroupId, templateOptions]);
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
    return buildFailedListCsvText(groupId, lastApplyResult, memberNameMap);
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
      <div className="rounded-[24px] border border-subtle bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h3 className="text-sm font-semibold text-foreground">{t('group_templates')}</h3>
            <p className="mt-1 text-sm leading-6 text-secondary">{t('group_templates_description')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[18px] border border-white/6 bg-white/[0.025] px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
                {t('group_templates')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{groups.length}</p>
            </div>
            <div className="rounded-[18px] border border-white/6 bg-white/[0.025] px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
                {t('select_members')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{members.length}</p>
            </div>
            <div className="rounded-[18px] border border-white/6 bg-white/[0.025] px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
                {t('select_template')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{templateOptions.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <GroupEditorCard
          ref={editorCardRef}
          allPagedSelected={allPagedSelected}
          canManage={canManage}
          commonT={commonT}
          createPending={createGroup.isPending}
          editingGroupId={editingGroupId}
          editingGroupName={editingGroupName ?? undefined}
          filteredMembersCount={filteredMembers.length}
          groupName={name}
          groupNameInputRef={groupNameInputRef}
          hasAnyPagedSelected={hasAnyPagedSelected}
          memberPage={memberPage}
          memberPageCount={memberPageCount}
          memberSearch={memberSearch}
          membersT={membersT}
          pagedMembers={pagedMembers}
          selectedMemberIds={selectedMemberIds}
          selectedTemplate={selectedTemplate}
          selectedTemplateId={templateId}
          selectedTemplatePermissionsCount={selectedTemplatePermissionsCount}
          templateOptions={templateOptions}
          t={t}
          updatePending={updateGroup.isPending}
          createTemplatePending={createPermissionTemplate.isPending}
          updateTemplatePending={updatePermissionTemplate.isPending}
          onCancelEdit={resetForm}
          onClearPage={deselectAllPagedMembers}
          onCreateTemplate={() => setCreateTemplateOpen(true)}
          onEditTemplate={() => setEditTemplateOpen(true)}
          onGroupNameChange={setName}
          onMemberPageChange={setMemberPage}
          onMemberSearchChange={(value) => {
            setMemberSearch(value);
            setMemberPage(1);
          }}
          onSave={() => {
            void handleSaveGroup();
          }}
          onSelectMember={toggleMember}
          onSelectPage={selectAllPagedMembers}
          onTemplateIdChange={setTemplateId}
        />

        <div className="space-y-3 rounded-[24px] border border-subtle bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold text-foreground">{t('group_templates')}</h4>
            <p className="text-sm leading-6 text-secondary">
              {groups.length === 0 ? t('group_empty') : t('selected_count', { count: groups.length })}
            </p>
          </div>
          <GroupList
            applyPending={applyGroupTemplate.isPending}
            canManage={canManage}
            deletePending={deleteGroup.isPending}
            groups={groups}
            lastApplyResult={lastApplyResult}
            memberNameMap={memberNameMap}
            previewDiffs={previewDiffs}
            previewGroupId={previewGroupId}
            t={t}
            templateNameMap={templateNameMap}
            onApply={(group) => {
              void handleApplyGroup(group);
            }}
            onCopyFailed={(groupId) => {
              void handleCopyFailedList(groupId);
            }}
            onDelete={setGroupToDelete}
            onEdit={startEdit}
            onExportFailed={handleExportFailedList}
            onPreviewToggle={(groupId) => setPreviewGroupId(previewGroupId === groupId ? null : groupId)}
            onRetryFailed={(groupId, failedMemberIds) => {
              void handleRetryFailed(groupId, failedMemberIds);
            }}
          />
        </div>
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
                const deletedGroupId = groupToDelete.id;
                void deleteGroup.mutateAsync(deletedGroupId);
                if (editingGroupId === deletedGroupId || previewGroupId === deletedGroupId) {
                  resetForm();
                }
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

      <CreateTemplateDrawer
        open={createTemplateOpen}
        onOpenChange={setCreateTemplateOpen}
        onSubmit={handleCreateTemplate}
      />

      {selectedTemplate && !selectedTemplate.is_default ? (
        <EditTemplateDrawer
          open={editTemplateOpen}
          onOpenChange={setEditTemplateOpen}
          template={{
            id: selectedTemplate.id,
            name: selectedTemplate.name,
            description: selectedTemplate.description,
            permissions: selectedTemplate.permissions,
            is_default: false,
            is_readonly: false,
          }}
          onSubmit={handleEditTemplate}
        />
      ) : null}
    </div>
  );
}
