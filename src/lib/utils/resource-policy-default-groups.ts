type SubjectOption = {
  id: string;
  label: string;
};

const DEFAULT_RESOURCE_POLICY_GROUP_IDS = [
  'grp_project_owner',
  'grp_project_admins',
  'grp_project_members',
] as const;

type DefaultResourcePolicyGroupId = (typeof DEFAULT_RESOURCE_POLICY_GROUP_IDS)[number];

export function buildDefaultResourcePolicyGroupOptions(
  tMembers: (key: string) => string,
): SubjectOption[] {
  return DEFAULT_RESOURCE_POLICY_GROUP_IDS.map((id) => {
    if (id === 'grp_project_owner') {
      return { id, label: tMembers('default_templates.owner') };
    }
    if (id === 'grp_project_admins') {
      return { id, label: tMembers('default_templates.admin') };
    }
    return { id, label: tMembers('default_templates.user') };
  });
}

export function mergeResourcePolicyGroupOptions(
  defaultOptions: SubjectOption[],
  customOptions: SubjectOption[],
): SubjectOption[] {
  const deduped = new Map<string, SubjectOption>();
  for (const option of defaultOptions) {
    deduped.set(option.id, option);
  }
  for (const option of customOptions) {
    if (!deduped.has(option.id)) {
      deduped.set(option.id, option);
    }
  }
  return Array.from(deduped.values());
}

export function isDefaultResourcePolicyGroupId(value: string): value is DefaultResourcePolicyGroupId {
  return DEFAULT_RESOURCE_POLICY_GROUP_IDS.includes(value as DefaultResourcePolicyGroupId);
}
