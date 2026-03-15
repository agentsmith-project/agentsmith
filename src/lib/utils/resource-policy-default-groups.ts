type SubjectOption = {
  id: string;
  label: string;
};

const DEFAULT_RESOURCE_POLICY_GROUP_IDS = ['owner', 'admin', 'developer', 'user'] as const;

type DefaultResourcePolicyGroupId = (typeof DEFAULT_RESOURCE_POLICY_GROUP_IDS)[number];

export function buildDefaultResourcePolicyGroupOptions(
  tMembers: (key: string) => string,
): SubjectOption[] {
  return DEFAULT_RESOURCE_POLICY_GROUP_IDS.map((id) => ({
    id,
    label: tMembers(`default_templates.${id}`),
  }));
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
