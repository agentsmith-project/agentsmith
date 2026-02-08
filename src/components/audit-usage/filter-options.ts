export const AUDIT_ACTION_OPTIONS = [
  'project.create',
  'project.update',
  'project.delete',
  'member.add',
  'member.update',
  'member.remove',
  'agent.create',
  'agent.update',
  'agent.delete',
  'agent.key.issue',
  'agent.key.revoke',
  'endpoint.create',
  'endpoint.update',
  'endpoint.delete',
  'endpoint.invoke',
  'source.file.upload',
  'source.file.delete',
  'source.file.download',
  'resource_policy.update',
  'credential.create',
  'credential.update',
  'credential.delete',
] as const;

export const AUDIT_RESOURCE_TYPE_OPTIONS = [
  'project',
  'member',
  'agent',
  'endpoint',
  'source_library',
  'source_file',
  'resource_policy',
  'credential',
] as const;

export const USAGE_RESOURCE_TYPE_OPTIONS = [
  'endpoint',
  'source_library',
  'agent',
] as const;

export function formatFilterToken(value: string): string {
  return value
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
