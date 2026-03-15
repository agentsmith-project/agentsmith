import { getProjectBuiltInTemplateOptions } from '@/lib/governance/member-groups';

import type {
  ApplyResultState,
  GroupMemberLike,
  GroupTemplateOption,
  PreviewDiff,
  ProjectGroupLike,
} from './types';

export function buildDefaultTemplates(t: (key: string) => string): GroupTemplateOption[] {
  return getProjectBuiltInTemplateOptions(t);
}

export function buildTemplateOptions(
  defaultTemplates: GroupTemplateOption[],
  templates: GroupTemplateOption[],
): GroupTemplateOption[] {
  const deduped = new Map<string, GroupTemplateOption>();
  for (const template of defaultTemplates) deduped.set(template.id, template);
  for (const template of templates) {
    deduped.set(template.id, {
      ...deduped.get(template.id),
      ...template,
      is_default: template.is_default ?? deduped.get(template.id)?.is_default,
    });
  }
  return Array.from(deduped.values());
}

export function getTemplatePermissions(
  templateIdValue: string,
  templateOptions: GroupTemplateOption[],
): string[] {
  const custom = templateOptions.find((template) => template.id === templateIdValue);
  return custom?.permissions ?? [];
}

export function buildPreviewDiffs(
  groups: ProjectGroupLike[],
  members: GroupMemberLike[],
  previewGroupId: string | null,
  templateOptions: GroupTemplateOption[],
): PreviewDiff[] {
  if (!previewGroupId) return [];
  const group = groups.find((item) => item.id === previewGroupId);
  if (!group) return [];
  const memberNameMap = new Map(members.map((member) => [member.id, member.name || member.email || member.id]));
  const templatePermissions = new Set(getTemplatePermissions(group.permission_template_id, templateOptions));

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
}

export function buildFailedListText(
  groupId: string,
  lastApplyResult: ApplyResultState,
  memberNameMap: Map<string, string>,
): string {
  if (!lastApplyResult || lastApplyResult.groupId !== groupId) return '';
  return lastApplyResult.failedDetails
    .map((item) => `${item.memberId},${memberNameMap.get(item.memberId) ?? item.memberId},${item.message ?? ''}`)
    .join('\n');
}
