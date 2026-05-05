export const AUDIT_ACTION_OPTIONS = [
  'project.create',
  'project.update',
  'project.delete',
  'member.add',
  'member.update',
  'member.remove',
  'agent_runner.create',
  'agent_runner.update',
  'agent_runner.delete',
  'agent_runner.key.issue',
  'agent_runner.key.revoke',
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
  'agent_runner',
  'endpoint',
  'file_library',
  'source_file',
  'resource_policy',
  'credential',
] as const;

export const USAGE_RESOURCE_TYPE_OPTIONS = [
  'endpoint',
  'file_library',
  'agent_runner',
] as const;

export function formatFilterToken(value: string): string {
  return value
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
