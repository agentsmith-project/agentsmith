export type SubstrateCaServiceId = 'postgresql' | 'mongodb' | 'redis' | 'object-storage' | 'oidc';

export type ResolvedSubstrateCa = {
  id: SubstrateCaServiceId;
  volumeName: string;
  mountDir: string;
  caFilePath: string;
  secretName: string;
  secretKey: string;
  tlsMode: string;
};

type SubstrateCaDefinition = {
  id: SubstrateCaServiceId;
  volumeName: string;
  mountSegment: string;
  tlsModeKeys: readonly string[];
  caSecretRefKeys: readonly string[];
  caSecretKeyKeys: readonly string[];
};

const SECRET_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u;
const SECRET_DATA_KEY_PATTERN = /^[A-Za-z0-9._-]+$/u;

export const SUBSTRATE_CA_BASE_DIR = '/etc/agentsmith/substrate-ca';
export const NODE_SUBSTRATE_CA_BUNDLE_DIR = '/etc/agentsmith/substrate-ca-bundle';
export const NODE_SUBSTRATE_CA_BUNDLE_PATH = `${NODE_SUBSTRATE_CA_BUNDLE_DIR}/ca-bundle.crt`;
export const SUBSTRATE_CA_PROJECTED_PATH = 'ca.crt';

const DEFAULT_CA_SECRET_KEY = SUBSTRATE_CA_PROJECTED_PATH;

const SUBSTRATE_CA_DEFINITIONS = [
  {
    id: 'postgresql',
    volumeName: 'substrate-postgresql-ca',
    mountSegment: 'postgresql',
    tlsModeKeys: [
      'SUBSTRATE_POSTGRES_TLS_MODE',
      'SUBSTRATE_POSTGRESQL_TLS_MODE',
      'SUBSTRATE_POSTGRES_SSLMODE',
      'SUBSTRATE_POSTGRESQL_SSLMODE',
    ],
    caSecretRefKeys: [
      'SUBSTRATE_POSTGRES_CA_SECRET_REF',
      'SUBSTRATE_POSTGRESQL_CA_SECRET_REF',
    ],
    caSecretKeyKeys: [
      'SUBSTRATE_POSTGRES_CA_SECRET_KEY',
      'SUBSTRATE_POSTGRESQL_CA_SECRET_KEY',
    ],
  },
  {
    id: 'mongodb',
    volumeName: 'substrate-mongodb-ca',
    mountSegment: 'mongodb',
    tlsModeKeys: ['SUBSTRATE_MONGODB_TLS_MODE'],
    caSecretRefKeys: ['SUBSTRATE_MONGODB_CA_SECRET_REF'],
    caSecretKeyKeys: ['SUBSTRATE_MONGODB_CA_SECRET_KEY'],
  },
  {
    id: 'redis',
    volumeName: 'substrate-redis-ca',
    mountSegment: 'redis',
    tlsModeKeys: ['SUBSTRATE_REDIS_TLS_MODE'],
    caSecretRefKeys: ['SUBSTRATE_REDIS_CA_SECRET_REF'],
    caSecretKeyKeys: ['SUBSTRATE_REDIS_CA_SECRET_KEY'],
  },
  {
    id: 'object-storage',
    volumeName: 'substrate-object-storage-ca',
    mountSegment: 'object-storage',
    tlsModeKeys: [
      'SUBSTRATE_OBJECT_STORAGE_TLS_MODE',
      'SUBSTRATE_MINIO_TLS_MODE',
    ],
    caSecretRefKeys: [
      'SUBSTRATE_OBJECT_STORAGE_CA_SECRET_REF',
      'SUBSTRATE_MINIO_CA_SECRET_REF',
    ],
    caSecretKeyKeys: [
      'SUBSTRATE_OBJECT_STORAGE_CA_SECRET_KEY',
      'SUBSTRATE_MINIO_CA_SECRET_KEY',
    ],
  },
  {
    id: 'oidc',
    volumeName: 'substrate-oidc-ca',
    mountSegment: 'oidc',
    tlsModeKeys: [
      'SUBSTRATE_OIDC_TLS_MODE',
      'SUBSTRATE_KEYCLOAK_TLS_MODE',
    ],
    caSecretRefKeys: [
      'SUBSTRATE_OIDC_CA_SECRET_REF',
      'SUBSTRATE_KEYCLOAK_CA_SECRET_REF',
    ],
    caSecretKeyKeys: [
      'SUBSTRATE_OIDC_CA_SECRET_KEY',
      'SUBSTRATE_KEYCLOAK_CA_SECRET_KEY',
    ],
  },
] as const satisfies readonly SubstrateCaDefinition[];

export const SUBSTRATE_CA_OPTIONAL_ENV_KEYS = [
  ...new Set(SUBSTRATE_CA_DEFINITIONS.flatMap((definition) => [
    ...definition.tlsModeKeys,
    ...definition.caSecretRefKeys,
    ...definition.caSecretKeyKeys,
  ])),
] as const;

function firstValue(values: Record<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = values[key]?.trim();
    if (value) {
      return value;
    }
  }

  return '';
}

export function substrateTlsModeForService(
  values: Record<string, string>,
  service: SubstrateCaServiceId,
): string {
  const definition = SUBSTRATE_CA_DEFINITIONS.find((item) => item.id === service);
  return definition ? firstValue(values, definition.tlsModeKeys) : '';
}

export function isSubstrateTlsEnabled(rawMode: string | undefined): boolean {
  const mode = rawMode?.trim().toLowerCase() ?? '';
  if (!mode) {
    return false;
  }

  return ![
    '0',
    'false',
    'no',
    'off',
    'disable',
    'disabled',
    'none',
    'plain',
    'plaintext',
    'http',
  ].includes(mode);
}

function parseSecretRef(rawValue: string, key: string, namespace: string): string {
  const normalized = rawValue.trim().replace(/^secretRef:/u, '');
  const parts = normalized.split('/');
  const name = parts.length === 1 ? parts[0] : parts.length === 2 ? parts[1] : '';
  const refNamespace = parts.length === 2 ? parts[0] : namespace;

  if (!name || !SECRET_NAME_PATTERN.test(name)) {
    throw new Error(`${key} must be a Kubernetes Secret name or secretRef:${namespace}/name`);
  }
  if (refNamespace !== namespace) {
    throw new Error(`${key} namespace must be ${namespace}; pod Secret volumes cannot cross namespaces`);
  }

  return name;
}

export function isKubernetesSecretDataKey(value: string): boolean {
  return SECRET_DATA_KEY_PATTERN.test(value);
}

function resolveCaSecretKey(values: Record<string, string>, definition: SubstrateCaDefinition): string {
  for (const key of definition.caSecretKeyKeys) {
    const value = values[key]?.trim();
    if (!value) {
      continue;
    }
    if (!isKubernetesSecretDataKey(value)) {
      throw new Error(
        `${key} must be a Kubernetes Secret data key containing only alphanumeric characters, '.', '_' or '-'`,
      );
    }

    return value;
  }

  return DEFAULT_CA_SECRET_KEY;
}

export function resolveSubstrateCaProjection(
  values: Record<string, string>,
  namespace: string,
): ResolvedSubstrateCa[] {
  const resolved: ResolvedSubstrateCa[] = [];

  for (const definition of SUBSTRATE_CA_DEFINITIONS) {
    const tlsMode = firstValue(values, definition.tlsModeKeys);
    const caSecretRef = firstValue(values, definition.caSecretRefKeys);
    const tlsEnabled = isSubstrateTlsEnabled(tlsMode);
    if (!tlsEnabled && !caSecretRef) {
      continue;
    }
    if (!tlsEnabled) {
      throw new Error(`${definition.caSecretRefKeys.join(' or ')} requires ${definition.tlsModeKeys.join(' or ')}`);
    }
    if (!caSecretRef) {
      throw new Error(`${definition.tlsModeKeys.join(' or ')}=${tlsMode} requires ${definition.caSecretRefKeys.join(' or ')}`);
    }

    const mountDir = `${SUBSTRATE_CA_BASE_DIR}/${definition.mountSegment}`;
    resolved.push({
      id: definition.id,
      volumeName: definition.volumeName,
      mountDir,
      caFilePath: `${mountDir}/${SUBSTRATE_CA_PROJECTED_PATH}`,
      secretName: parseSecretRef(caSecretRef, definition.caSecretRefKeys[0] ?? 'SUBSTRATE_CA_SECRET_REF', namespace),
      secretKey: resolveCaSecretKey(values, definition),
      tlsMode,
    });
  }

  return resolved;
}

export function substrateCaForService(
  projection: readonly ResolvedSubstrateCa[],
  service: SubstrateCaServiceId,
): ResolvedSubstrateCa | undefined {
  return projection.find((ca) => ca.id === service);
}
