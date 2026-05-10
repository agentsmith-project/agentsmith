export const AFSCP_ACTOR_TYPES = [
  'user',
  'system',
  'admin_job',
  'migration_job',
  'operator',
] as const;

export type AfscpActorType = typeof AFSCP_ACTOR_TYPES[number];

export type AfscpValidatedValueKind =
  | 'actor_id'
  | 'caller_service'
  | 'correlation_id'
  | 'idempotency_key'
  | 'namespace_id'
  | 'operation_id'
  | 'repo_id'
  | 'save_point_id'
  | 'template_id'
  | 'export_id'
  | 'mount_binding_id'
  | 'volume_id';

const VALUE_PATTERNS: Record<AfscpValidatedValueKind, RegExp> = {
  actor_id: /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/,
  caller_service: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  correlation_id: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  idempotency_key: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/,
  namespace_id: /^ns_[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/,
  operation_id: /^op_[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/,
  repo_id: /^repo_[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/,
  save_point_id: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/,
  template_id: /^tmpl_[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/,
  export_id: /^export_[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/,
  mount_binding_id: /^wmb_[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/,
  volume_id: /^vol_[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/,
};

const ACTOR_TYPE_SET = new Set<string>(AFSCP_ACTOR_TYPES);

export function normalizeAfscpValidatedValue(
  kind: AfscpValidatedValueKind,
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !VALUE_PATTERNS[kind].test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function sanitizeAfscpNamespaceId(value: string | null | undefined): string | undefined {
  return normalizeAfscpValidatedValue('namespace_id', value);
}

export function normalizeAfscpActorType(value: unknown): AfscpActorType | undefined {
  if (typeof value !== 'string' || !ACTOR_TYPE_SET.has(value)) {
    return undefined;
  }
  return value as AfscpActorType;
}
