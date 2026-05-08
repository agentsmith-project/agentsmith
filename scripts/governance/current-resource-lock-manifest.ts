import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listCurrentGateDefinitions } from './current-gate-manifest';
import { listCurrentRuntimeLines } from './current-runtime-line-manifest';

export const CURRENT_RESOURCE_LOCK_MANIFEST_SCHEMA = 'current-resource-lock-manifest.v1' as const;
export const CURRENT_RESOURCE_LOCK_MANIFEST_VERSION = 1 as const;

export const CURRENT_RESOURCE_LOCK_IDS = [
  'next-source-contract',
  'shared-local-substrate',
  'destructive-lifecycle',
  'fixed-local-ports',
  'runtime-current-aliases',
  'release-latest-pointer',
  'release-campaign-root-writes',
  'scenario-world',
  'backend-real-provider-quota',
  'provider-secret-profile',
  'visual-baseline-update',
] as const;

export type CurrentResourceLockId = (typeof CURRENT_RESOURCE_LOCK_IDS)[number];
export type CurrentResourceLockCategory =
  | 'source_state'
  | 'substrate'
  | 'lifecycle'
  | 'port'
  | 'mutable_alias'
  | 'release_pointer'
  | 'campaign_root'
  | 'scenario_world'
  | 'provider_quota'
  | 'secret_profile'
  | 'visual_baseline';
export type CurrentResourceLockScope = 'repo' | 'local_host' | 'campaign' | 'runtime_line' | 'provider_profile';
export type CurrentResourceLockMode = 'exclusive' | 'shared_read';
export type CurrentResourceLockEnforcement =
  | 'modeled_only'
  | 'existing_shell_lock'
  | 'existing_preflight_cleanup';

export type CurrentResourceLockPort =
  | {
      kind: 'port';
      value: number;
      label?: string;
    }
  | {
      kind: 'range';
      start: number;
      end: number;
      label?: string;
    }
  | {
      kind: 'family';
      name: string;
      values?: readonly number[];
      pattern?: string;
      label?: string;
    };

export interface CurrentResourceLockOwners {
  gateIds?: readonly string[];
  npmScripts?: readonly string[];
  commandSurfaces?: readonly string[];
}

export interface CurrentResourceLockAppliesTo {
  gateIds?: readonly string[];
  npmScripts?: readonly string[];
  runtimeLines?: readonly string[];
  paths?: readonly string[];
  ports?: readonly CurrentResourceLockPort[];
  providerProfiles?: readonly string[];
}

export interface CurrentResourceLockProfileReuse {
  crossProviderProfileReuse: 'forbidden';
  crossSecretProfileReuse: 'forbidden';
  reason: string;
}

export interface CurrentResourceLockDefinition {
  id: CurrentResourceLockId | string;
  category: CurrentResourceLockCategory;
  scope: CurrentResourceLockScope;
  mode: CurrentResourceLockMode;
  reason: string;
  owners: CurrentResourceLockOwners;
  appliesTo: CurrentResourceLockAppliesTo;
  enforcement: CurrentResourceLockEnforcement;
  existingImplementation?: readonly string[];
  profileReuse?: CurrentResourceLockProfileReuse;
}

export interface CurrentResourceLockManifestFailure {
  index: number;
  id?: string;
  path: string;
  reason: string;
}

export type CurrentResourceLockManifestValidationResult =
  | {
      ok: true;
      value: readonly CurrentResourceLockDefinition[];
    }
  | {
      ok: false;
      failures: readonly CurrentResourceLockManifestFailure[];
    };

const TOP_LEVEL_FIELDS = [
  'id',
  'category',
  'scope',
  'mode',
  'reason',
  'owners',
  'appliesTo',
  'enforcement',
  'existingImplementation',
  'profileReuse',
] as const;

const REQUIRED_TOP_LEVEL_FIELDS = [
  'id',
  'category',
  'scope',
  'mode',
  'reason',
  'owners',
  'appliesTo',
  'enforcement',
] as const;

const RESOURCE_LOCK_CATEGORIES = [
  'source_state',
  'substrate',
  'lifecycle',
  'port',
  'mutable_alias',
  'release_pointer',
  'campaign_root',
  'scenario_world',
  'provider_quota',
  'secret_profile',
  'visual_baseline',
] as const satisfies readonly CurrentResourceLockCategory[];

const RESOURCE_LOCK_SCOPES = [
  'repo',
  'local_host',
  'campaign',
  'runtime_line',
  'provider_profile',
] as const satisfies readonly CurrentResourceLockScope[];

const RESOURCE_LOCK_MODES = [
  'exclusive',
  'shared_read',
] as const satisfies readonly CurrentResourceLockMode[];

const RESOURCE_LOCK_ENFORCEMENTS = [
  'modeled_only',
  'existing_shell_lock',
  'existing_preflight_cleanup',
] as const satisfies readonly CurrentResourceLockEnforcement[];

const GENERIC_LOCK_IDS = new Set(['', 'runtime', 'resource', 'lock', 'ports']);
const MAX_PORT_RANGE_SIZE = 100;
const TOP_LEVEL_FIELD_SET = new Set<string>(TOP_LEVEL_FIELDS);
const REQUIRED_TOP_LEVEL_FIELD_SET = new Set<string>(REQUIRED_TOP_LEVEL_FIELDS);
const EXPECTED_LOCK_ID_SET = new Set<string>(CURRENT_RESOURCE_LOCK_IDS);
const CATEGORY_SET = new Set<string>(RESOURCE_LOCK_CATEGORIES);
const SCOPE_SET = new Set<string>(RESOURCE_LOCK_SCOPES);
const MODE_SET = new Set<string>(RESOURCE_LOCK_MODES);
const ENFORCEMENT_SET = new Set<string>(RESOURCE_LOCK_ENFORCEMENTS);
const OWNERS_FIELD_SET = new Set<string>(['gateIds', 'npmScripts', 'commandSurfaces']);
const APPLIES_TO_FIELD_SET = new Set<string>([
  'gateIds',
  'npmScripts',
  'runtimeLines',
  'paths',
  'ports',
  'providerProfiles',
]);
const PROFILE_REUSE_FIELD_SET = new Set<string>([
  'crossProviderProfileReuse',
  'crossSecretProfileReuse',
  'reason',
]);
const PORT_FIELD_SETS = {
  family: new Set<string>(['kind', 'name', 'values', 'pattern', 'label']),
  port: new Set<string>(['kind', 'value', 'label']),
  range: new Set<string>(['kind', 'start', 'end', 'label']),
  unknown: new Set<string>(['kind', 'name', 'values', 'pattern', 'value', 'start', 'end', 'label']),
} as const;
const PATH_PATTERN_CATEGORIES = new Set<CurrentResourceLockCategory>([
  'mutable_alias',
  'campaign_root',
  'release_pointer',
  'scenario_world',
  'visual_baseline',
]);
const PROFILE_REUSE_CATEGORIES = new Set<CurrentResourceLockCategory>([
  'provider_quota',
  'secret_profile',
]);

export const CURRENT_RESOURCE_LOCK_MANIFEST: readonly CurrentResourceLockDefinition[] = [
  {
    id: 'next-source-contract',
    category: 'source_state',
    scope: 'repo',
    mode: 'shared_read',
    reason: 'Next.js source, generated API contracts, and governance contract checks share one repo source-state truth.',
    owners: {
      gateIds: ['governance-default', 'gate-default'],
      npmScripts: ['contracts:check', 'contracts:check-openapi', 'openapi:check-generated'],
      commandSurfaces: ['contract verification', 'openapi generation check'],
    },
    appliesTo: {
      gateIds: ['governance-default', 'gate-default'],
      npmScripts: [
        'contracts:check',
        'contracts:check-openapi',
        'openapi:check-generated',
        'test:governance',
        'gate:default',
      ],
      paths: [
        'src/**/*',
        'docs/contracts/**/*',
        'scripts/contracts/**/*',
        'scripts/governance/**/*',
      ],
    },
    enforcement: 'modeled_only',
  },
  {
    id: 'shared-local-substrate',
    category: 'substrate',
    scope: 'local_host',
    mode: 'exclusive',
    reason: 'Local backend, browser, and unified deploy substrate checks compete for the same host services and should not be treated as independent worlds.',
    owners: {
      gateIds: [
        'test-backend-real-core',
        'lane-backend-real-core',
        'lane-backend-real-release',
        'lane-unified-deploy-substrate',
        'lane-unified-deploy-local-kind-images',
        'lane-unified-deploy-local-kind',
        'lane-unified-deploy-product-flows',
      ],
      npmScripts: [
        'backend-real:run',
        'lane:backend-real:core',
        'lane:backend-real:release',
        'lane:unified-deploy:substrate',
        'lane:unified-deploy:local-kind:images',
        'lane:unified-deploy:local-kind',
        'lane:unified-deploy:product-flows',
      ],
      commandSurfaces: ['backend-real stack', 'unified deploy local substrate'],
    },
    appliesTo: {
      gateIds: [
        'test-backend-real-core',
        'lane-backend-real-core',
        'lane-backend-real-release',
        'lane-unified-deploy-substrate',
        'lane-unified-deploy-local-kind-images',
        'lane-unified-deploy-local-kind',
        'lane-unified-deploy-product-flows',
      ],
      npmScripts: [
        'integration:deps:up',
        'integration:deps:down',
        'backend-real:bootstrap',
        'backend-real:run',
        'test:backend-real:core',
        'lane:backend-real:core',
        'lane:backend-real:release',
        'lane:unified-deploy:substrate',
        'lane:unified-deploy:local-kind:images',
        'lane:unified-deploy:local-kind',
        'lane:unified-deploy:product-flows',
      ],
      runtimeLines: ['local-manual', 'unified-deploy-local-kind'],
      paths: [
        'artifacts/runtime/lines/<runtime-line-id>/**',
        'artifacts/backend-real/runs/<run-id>/**',
        'artifacts/unified-deploy/**',
      ],
    },
    enforcement: 'existing_preflight_cleanup',
    existingImplementation: [
      'scripts/backend-real-reset.sh',
      'scripts/unified-deploy/substrate-lifecycle.ts',
    ],
  },
  {
    id: 'destructive-lifecycle',
    category: 'lifecycle',
    scope: 'local_host',
    mode: 'exclusive',
    reason: 'Reset, down, cleanup, and unified deploy local-kind lifecycle commands can invalidate another active local run.',
    owners: {
      gateIds: ['lane-unified-deploy-substrate', 'lane-unified-deploy-local-kind', 'lane-backend-real-release'],
      npmScripts: [
        'integration:deps:down',
        'integration:deps:down:volumes',
        'backend-real:reset',
        'lane:backend-real:release',
        'lane:unified-deploy:substrate',
        'lane:unified-deploy:local-kind',
      ],
      commandSurfaces: ['reset commands', 'destructive down commands'],
    },
    appliesTo: {
      gateIds: ['lane-unified-deploy-substrate', 'lane-unified-deploy-local-kind', 'lane-backend-real-release'],
      npmScripts: [
        'integration:deps:down',
        'integration:deps:down:volumes',
        'backend-real:reset',
        'lane:backend-real:release',
        'lane:unified-deploy:substrate',
        'lane:unified-deploy:local-kind',
      ],
      runtimeLines: ['local-manual', 'unified-deploy-local-kind'],
      paths: [
        'scripts/backend-real-reset.sh',
        'scripts/unified-deploy/substrate-lifecycle.ts',
      ],
    },
    enforcement: 'existing_preflight_cleanup',
    existingImplementation: [
      'scripts/backend-real-reset.sh',
      'scripts/unified-deploy/substrate-lifecycle.ts',
    ],
  },
  {
    id: 'fixed-local-ports',
    category: 'port',
    scope: 'local_host',
    mode: 'exclusive',
    reason: 'The dev API, Next app, local registry, and unified deploy local-kind ingress use fixed host ports that cannot be shared by concurrent runs.',
    owners: {
      gateIds: [
        'gate-default',
        'lane-visual',
        'test-backend-real-core',
        'lane-backend-real-release',
        'gate-release',
        'lane-unified-deploy-substrate',
        'lane-unified-deploy-local-kind-images',
        'lane-unified-deploy-local-kind',
        'lane-unified-deploy-product-flows',
      ],
      npmScripts: [
        'dev',
        'gate:default',
        'lane:visual',
        'backend-real:run',
        'lane:backend-real:release',
        'gate:release',
        'lane:unified-deploy:substrate',
        'lane:unified-deploy:local-kind:images',
        'lane:unified-deploy:local-kind',
        'lane:unified-deploy:product-flows',
      ],
      commandSurfaces: ['local dev services', 'unified deploy local-kind services'],
    },
    appliesTo: {
      gateIds: [
        'gate-default',
        'lane-visual',
        'test-backend-real-core',
        'lane-backend-real-release',
        'gate-release',
        'lane-unified-deploy-substrate',
        'lane-unified-deploy-local-kind-images',
        'lane-unified-deploy-local-kind',
        'lane-unified-deploy-product-flows',
      ],
      npmScripts: [
        'dev',
        'api:node:dev',
        'gate:default',
        'lane:visual',
        'integration:deps:up',
        'backend-real:run',
        'test:backend-real:core',
        'lane:backend-real:release',
        'gate:release',
        'lane:unified-deploy:substrate',
        'lane:unified-deploy:local-kind:images',
        'lane:unified-deploy:local-kind',
        'lane:unified-deploy:product-flows',
      ],
      runtimeLines: ['local-manual', 'unified-deploy-local-kind'],
      ports: [
        {
          kind: 'port',
          value: 20000,
          label: 'API backend base port',
        },
        {
          kind: 'port',
          value: 3000,
          label: 'Web local app default port',
        },
        {
          kind: 'port',
          value: 3001,
          label: 'Web Playwright-managed app port',
        },
        {
          kind: 'port',
          value: 15432,
          label: 'PG integration database port',
        },
        {
          kind: 'port',
          value: 17017,
          label: 'Mongo integration database port',
        },
        {
          kind: 'port',
          value: 16379,
          label: 'Redis integration cache port',
        },
        {
          kind: 'port',
          value: 19000,
          label: 'MinIO API port',
        },
        {
          kind: 'port',
          value: 19001,
          label: 'MinIO console port',
        },
        {
          kind: 'port',
          value: 18080,
          label: 'Keycloak identity port',
        },
        {
          kind: 'port',
          value: 38080,
          label: 'universal proxy port',
        },
        {
          kind: 'family',
          name: 'unified-deploy-local-kind-ingress-host-ports',
          values: [29180],
          label: 'unified deploy local-kind ingress host port',
        },
        {
          kind: 'family',
          name: 'unified-deploy-local-registry-host-ports',
          values: [5001],
          label: 'unified deploy local registry host port',
        },
      ],
    },
    enforcement: 'modeled_only',
  },
  {
    id: 'runtime-current-aliases',
    category: 'mutable_alias',
    scope: 'runtime_line',
    mode: 'exclusive',
    reason: 'Each runtime line has a mutable current alias that should point to one active line state at a time.',
    owners: {
      gateIds: ['governance-default'],
      npmScripts: ['current-runtime-lines:check', 'current-runtime-lines:sync'],
      commandSurfaces: ['runtime line current alias'],
    },
    appliesTo: {
      gateIds: ['governance-default'],
      npmScripts: ['current-runtime-lines:check', 'current-runtime-lines:sync', 'test:governance'],
      runtimeLines: ['local-manual', 'unified-deploy-local-kind', 'unified-deploy-existing-cluster'],
      paths: [
        'artifacts/runtime/lines/<runtime-line-id>/current',
        'artifacts/runtime/lines/<runtime-line-id>/current/**',
        'artifacts/backend-real/current/**',
        'artifacts/backend-real/current-run/**',
        'artifacts/mock-lane/current/**',
      ],
    },
    enforcement: 'modeled_only',
  },
  {
    id: 'release-latest-pointer',
    category: 'release_pointer',
    scope: 'repo',
    mode: 'exclusive',
    reason: 'The latest release pointer is mutable repo state and must not be reused as a stable campaign identity.',
    owners: {
      gateIds: ['gate-release-full'],
      npmScripts: ['release:ready', 'release:status', 'release:aggregate'],
      commandSurfaces: ['release readiness pointer', 'release status pointer'],
    },
    appliesTo: {
      gateIds: ['gate-release-full'],
      npmScripts: ['release:ready', 'release:status', 'release:aggregate', 'gate:release:full'],
      paths: [
        'artifacts/release-runs/latest.json',
        'artifacts/release-runs/<campaign-run-id>/latest.json',
      ],
    },
    enforcement: 'modeled_only',
  },
  {
    id: 'release-campaign-root-writes',
    category: 'campaign_root',
    scope: 'campaign',
    mode: 'exclusive',
    reason: 'Release campaign steps write structured evidence under one campaign root and must not share that mutable root across runs.',
    owners: {
      gateIds: ['gate-release-full'],
      npmScripts: ['release:campaign:full', 'release:aggregate', 'gate:release:full'],
      commandSurfaces: ['release campaign root writer', 'release aggregate verdict'],
    },
    appliesTo: {
      gateIds: [
        'lane-visual',
        'gate-release',
        'lane-unified-deploy-substrate',
        'lane-unified-deploy-local-kind-images',
        'lane-unified-deploy-local-kind',
        'lane-unified-deploy-product-flows',
        'gate-release-full',
      ],
      npmScripts: [
        'release:campaign:full',
        'release:aggregate',
        'gate:release:full',
        'lane:visual',
        'gate:release',
        'lane:unified-deploy:substrate',
        'lane:unified-deploy:local-kind:images',
        'lane:unified-deploy:local-kind',
        'lane:unified-deploy:product-flows',
      ],
      paths: [
        'artifacts/release-runs/<campaign-run-id>/**',
        '<campaign-root>/<campaign-step-id>/**',
      ],
    },
    enforcement: 'modeled_only',
  },
  {
    id: 'scenario-world',
    category: 'scenario_world',
    scope: 'local_host',
    mode: 'exclusive',
    reason: 'Retired demo and cluster rehearsal adapters still own their historical local worlds when invoked directly; they are not release campaign gates.',
    owners: {
      npmScripts: ['rehearse:demo', 'rehearse:cluster'],
      commandSurfaces: ['retired demo rehearsal world', 'retired cluster rehearsal world'],
    },
    appliesTo: {
      npmScripts: ['rehearse:demo', 'rehearse:cluster'],
      paths: [
        'scripts/scenarios/<scenario-id>/**',
        'artifacts/runtime/scenario/<scenario-id>/**',
      ],
      ports: [
        {
          kind: 'family',
          name: 'scenario-sandbox-host-ports',
          values: [29280, 29080],
        },
        {
          kind: 'family',
          name: 'scenario-local-registry-host-ports',
          values: [5002, 5003],
        },
      ],
    },
    enforcement: 'existing_preflight_cleanup',
    existingImplementation: [
      'scripts/scenarios/demo-rehearsal/reset.sh',
      'scripts/scenarios/cluster-rehearsal/reset.sh',
    ],
  },
  {
    id: 'backend-real-provider-quota',
    category: 'provider_quota',
    scope: 'provider_profile',
    mode: 'exclusive',
    reason: 'Backend-real provider quota is scoped to the configured provider profile and should not be amortized across unrelated profiles.',
    owners: {
      gateIds: ['test-backend-real-core', 'lane-backend-real-core', 'lane-backend-real-release', 'gate-release'],
      npmScripts: [
        'test:backend-real:core',
        'backend-real:run',
        'lane:backend-real:core',
        'lane:backend-real:release',
        'gate:release',
      ],
      commandSurfaces: ['backend-real provider calls', 'release backend-real provider calls'],
    },
    appliesTo: {
      gateIds: ['test-backend-real-core', 'lane-backend-real-core', 'lane-backend-real-release', 'gate-release'],
      npmScripts: [
        'test:backend-real:core',
        'backend-real:run',
        'lane:backend-real:core',
        'lane:backend-real:release',
        'gate:release',
      ],
      providerProfiles: ['backend-real-core', 'backend-real-release'],
    },
    enforcement: 'modeled_only',
    profileReuse: {
      crossProviderProfileReuse: 'forbidden',
      crossSecretProfileReuse: 'forbidden',
      reason: 'Quota observations from one provider or secret profile cannot be reused as evidence for another profile.',
    },
  },
  {
    id: 'provider-secret-profile',
    category: 'secret_profile',
    scope: 'provider_profile',
    mode: 'exclusive',
    reason: 'Provider secret profiles are credential boundaries; evidence from one secret profile must not validate another profile.',
    owners: {
      gateIds: ['test-backend-real-core', 'lane-backend-real-release'],
      npmScripts: [
        'test:feishu:real:credential',
        'manual:feishu:admin',
        'manual:feishu:user',
        'manual:feishu:check',
      ],
      commandSurfaces: ['managed credential checks', 'manual provider credential checks'],
    },
    appliesTo: {
      gateIds: ['test-backend-real-core', 'lane-backend-real-release'],
      npmScripts: [
        'test:feishu:real:credential',
        'manual:feishu:admin',
        'manual:feishu:user',
        'manual:feishu:check',
        'test:backend-real:core',
        'lane:backend-real:release',
      ],
      providerProfiles: ['feishu-admin', 'feishu-user', 'backend-real-managed-secret'],
    },
    enforcement: 'modeled_only',
    profileReuse: {
      crossProviderProfileReuse: 'forbidden',
      crossSecretProfileReuse: 'forbidden',
      reason: 'A secret-backed provider profile is not interchangeable with another provider or secret profile.',
    },
  },
  {
    id: 'visual-baseline-update',
    category: 'visual_baseline',
    scope: 'repo',
    mode: 'exclusive',
    reason: 'Visual baseline updates mutate committed screenshots and review artifacts and must stay single-owner per update run.',
    owners: {
      gateIds: ['visual-lane-command', 'lane-visual'],
      npmScripts: ['test:visual', 'lane:visual', 'test:e2e:lane:mock:visual:update'],
      commandSurfaces: ['visual baseline review', 'visual screenshot update'],
    },
    appliesTo: {
      gateIds: ['visual-lane-command', 'lane-visual'],
      npmScripts: ['test:visual', 'lane:visual', 'test:e2e:lane:mock:visual:update'],
      paths: [
        'e2e/__screenshots__/visual.spec.ts/**',
        'artifacts/visual-baseline-reviews/<run-id>/**',
        '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/**',
      ],
    },
    enforcement: 'modeled_only',
  },
] as const;

export function listCurrentResourceLocks(): readonly CurrentResourceLockDefinition[] {
  return CURRENT_RESOURCE_LOCK_MANIFEST;
}

export function findCurrentResourceLockById(id: string): CurrentResourceLockDefinition | undefined {
  return CURRENT_RESOURCE_LOCK_MANIFEST.find((lock) => lock.id === id);
}

export function validateCurrentResourceLockManifest(
  manifest: readonly unknown[] = CURRENT_RESOURCE_LOCK_MANIFEST,
): CurrentResourceLockManifestValidationResult {
  const failures: CurrentResourceLockManifestFailure[] = [];
  const gateDefinitions = listCurrentGateDefinitions();
  const gateIds = new Set(gateDefinitions.map((definition) => definition.id));
  const gateNpmScriptsById = new Map(gateDefinitions.map((definition) => [definition.id, definition.npmScript]));
  const runtimeLineIds = new Set(listCurrentRuntimeLines().map((line) => line.id));
  const packageScripts = readPackageScriptNames(failures);

  if (!Array.isArray(manifest)) {
    return {
      ok: false,
      failures: [
        {
          index: -1,
          path: 'manifest',
          reason: 'manifest must be an array.',
        },
      ],
    };
  }

  const seenIds = new Set<string>();

  manifest.forEach((entry, index) => {
    if (!isRecord(entry)) {
      failures.push({
        index,
        path: `[${index}]`,
        reason: 'resource lock entry must be an object.',
      });
      return;
    }

    const id = typeof entry.id === 'string' ? entry.id : undefined;
    const failureBase = { index, id };

    for (const key of Object.keys(entry)) {
      if (!TOP_LEVEL_FIELD_SET.has(key)) {
        failures.push({
          ...failureBase,
          path: `[${index}].${key}`,
          reason: `unknown top-level field "${key}".`,
        });

        if (isCamelCaseKey(key)) {
          failures.push({
            ...failureBase,
            path: `[${index}].${key}`,
            reason: `camelCase top-level key "${key}" is not allowed unless it is part of the resource lock schema.`,
          });
        }
      }
    }

    for (const field of REQUIRED_TOP_LEVEL_FIELD_SET) {
      if (!(field in entry)) {
        failures.push({
          ...failureBase,
          path: `[${index}].${field}`,
          reason: `${field} is required.`,
        });
      }
    }

    validateId(entry.id, index, seenIds, failures);
    validateEnum(entry.category, CATEGORY_SET, 'category', index, failures);
    validateEnum(entry.scope, SCOPE_SET, 'scope', index, failures);
    validateEnum(entry.mode, MODE_SET, 'mode', index, failures);
    validateRequiredString(entry.reason, 'reason', index, failures);
    validateEnum(entry.enforcement, ENFORCEMENT_SET, 'enforcement', index, failures);

    const owners = validateOwners(entry.owners, index, failures);
    const appliesTo = validateAppliesTo(entry.appliesTo, index, failures);

    if (owners) {
      validateStringArrayMembership(owners.gateIds, gateIds, 'owners.gateIds', 'unknown owner gate id', index, failures);
      validateStringArrayMembership(owners.npmScripts, packageScripts, 'owners.npmScripts', 'unknown owner npm script', index, failures);
    }

    if (appliesTo) {
      validateStringArrayMembership(appliesTo.gateIds, gateIds, 'appliesTo.gateIds', 'unknown appliesTo gate id', index, failures);
      validateStringArrayMembership(appliesTo.npmScripts, packageScripts, 'appliesTo.npmScripts', 'unknown appliesTo npm script', index, failures);
      validateStringArrayMembership(appliesTo.runtimeLines, runtimeLineIds, 'appliesTo.runtimeLines', 'unknown appliesTo runtime line', index, failures);
      validateAppliesToGateNpmScripts(appliesTo, gateNpmScriptsById, index, failures);
    }

    if (entry.enforcement !== 'modeled_only') {
      validateNonEmptyStringArray(entry.existingImplementation, 'existingImplementation', index, failures);
    }

    if (entry.category === 'port' || appliesTo?.ports !== undefined) {
      validatePorts(appliesTo?.ports, index, failures, entry.category === 'port');
    }

    if (typeof entry.category === 'string' && PATH_PATTERN_CATEGORIES.has(entry.category as CurrentResourceLockCategory)) {
      validatePathPattern(appliesTo?.paths, entry.category, index, failures);
    }

    if (
      entry.profileReuse !== undefined
      || (typeof entry.category === 'string' && PROFILE_REUSE_CATEGORIES.has(entry.category as CurrentResourceLockCategory))
    ) {
      validateProfileReuse(entry.profileReuse, index, failures);
    }

    if (typeof entry.category === 'string' && PROFILE_REUSE_CATEGORIES.has(entry.category as CurrentResourceLockCategory)) {
      validateNonEmptyStringArray(appliesTo?.providerProfiles, 'appliesTo.providerProfiles', index, failures);
    }
  });

  validateExpectedLockCoverage(seenIds, failures);

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: manifest as readonly CurrentResourceLockDefinition[],
  };
}

function readPackageScriptNames(failures: CurrentResourceLockManifestFailure[]): Set<string> {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as unknown;
    if (!isRecord(packageJson) || !isRecord(packageJson.scripts)) {
      failures.push({
        index: -1,
        path: 'package.json.scripts',
        reason: 'package.json scripts must be readable for resource lock validation.',
      });
      return new Set();
    }

    return new Set(Object.keys(packageJson.scripts));
  } catch (error: unknown) {
    failures.push({
      index: -1,
      path: 'package.json',
      reason: `package.json scripts must be readable for resource lock validation: ${String(error)}`,
    });
    return new Set();
  }
}

function validateId(
  value: unknown,
  index: number,
  seenIds: Set<string>,
  failures: CurrentResourceLockManifestFailure[],
): void {
  if (typeof value !== 'string' || value.length === 0) {
    failures.push({
      index,
      path: `[${index}].id`,
      reason: 'id must be a non-generic kebab-case string.',
    });
    return;
  }

  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || GENERIC_LOCK_IDS.has(value)) {
    failures.push({
      index,
      id: value,
      path: `[${index}].id`,
      reason: 'id must be a non-generic kebab-case string.',
    });
  }

  if (seenIds.has(value)) {
    failures.push({
      index,
      id: value,
      path: `[${index}].id`,
      reason: `duplicate resource lock id "${value}".`,
    });
  }

  seenIds.add(value);
}

function validateEnum(
  value: unknown,
  allowed: Set<string>,
  field: string,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    failures.push({
      index,
      path: `[${index}].${field}`,
      reason: `${field} is required and must be one of the current resource lock schema values.`,
    });
  }
}

function validateRequiredString(
  value: unknown,
  field: string,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({
      index,
      path: `[${index}].${field}`,
      reason: `${field} is required.`,
    });
  }
}

function validateOwners(
  value: unknown,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): CurrentResourceLockOwners | undefined {
  if (!isRecord(value)) {
    failures.push({
      index,
      path: `[${index}].owners`,
      reason: 'owners is required.',
    });
    return undefined;
  }

  validateAllowedFields(value, OWNERS_FIELD_SET, 'owners', 'owners', index, failures);
  validateOptionalStringArray(value.gateIds, 'owners.gateIds', index, failures);
  validateOptionalStringArray(value.npmScripts, 'owners.npmScripts', index, failures);
  validateOptionalStringArray(value.commandSurfaces, 'owners.commandSurfaces', index, failures);

  if (!hasAnyNonEmptyArray(value, ['gateIds', 'npmScripts', 'commandSurfaces'])) {
    failures.push({
      index,
      path: `[${index}].owners`,
      reason: 'owners must include at least one gateIds, npmScripts, or commandSurfaces entry.',
    });
  }

  return value as CurrentResourceLockOwners;
}

function validateAppliesTo(
  value: unknown,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): CurrentResourceLockAppliesTo | undefined {
  if (!isRecord(value)) {
    failures.push({
      index,
      path: `[${index}].appliesTo`,
      reason: 'appliesTo is required.',
    });
    return undefined;
  }

  validateAllowedFields(value, APPLIES_TO_FIELD_SET, 'appliesTo', 'appliesTo', index, failures);
  validateOptionalStringArray(value.gateIds, 'appliesTo.gateIds', index, failures);
  validateOptionalStringArray(value.npmScripts, 'appliesTo.npmScripts', index, failures);
  validateOptionalStringArray(value.runtimeLines, 'appliesTo.runtimeLines', index, failures);
  validateOptionalStringArray(value.paths, 'appliesTo.paths', index, failures);
  validateOptionalStringArray(value.providerProfiles, 'appliesTo.providerProfiles', index, failures);

  if (!hasAnyNonEmptyArray(value, ['gateIds', 'npmScripts', 'runtimeLines', 'paths', 'ports', 'providerProfiles'])) {
    failures.push({
      index,
      path: `[${index}].appliesTo`,
      reason: 'appliesTo must include at least one governed resource dimension.',
    });
  }

  return value as CurrentResourceLockAppliesTo;
}

function validateOptionalStringArray(
  value: unknown,
  pathSuffix: string,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    failures.push({
      index,
      path: `[${index}].${pathSuffix}`,
      reason: `${pathSuffix} must be an array of non-empty strings when present.`,
    });
  }
}

function validateNonEmptyStringArray(
  value: unknown,
  pathSuffix: string,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  validateOptionalStringArray(value, pathSuffix, index, failures);
  if (!Array.isArray(value) || value.length === 0) {
    failures.push({
      index,
      path: `[${index}].${pathSuffix}`,
      reason: `${pathSuffix} must be a non-empty string array.`,
    });
  }
}

function validateStringArrayMembership(
  value: readonly string[] | undefined,
  allowed: Set<string>,
  pathSuffix: string,
  reasonPrefix: string,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (!allowed.has(item)) {
      failures.push({
        index,
        path: `[${index}].${pathSuffix}`,
        reason: `${reasonPrefix} "${item}".`,
      });
    }
  }
}

function validateAppliesToGateNpmScripts(
  appliesTo: CurrentResourceLockAppliesTo,
  gateNpmScriptsById: ReadonlyMap<string, string>,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  if (
    !Array.isArray(appliesTo.gateIds)
    || appliesTo.gateIds.length === 0
  ) {
    return;
  }

  if (!Array.isArray(appliesTo.npmScripts) || appliesTo.npmScripts.length === 0) {
    failures.push({
      index,
      path: `[${index}].appliesTo.npmScripts`,
      reason: 'appliesTo gate npm script coverage requires a non-empty appliesTo.npmScripts array when appliesTo.gateIds is present.',
    });
    return;
  }

  const declaredNpmScripts = new Set(
    appliesTo.npmScripts.filter((npmScript): npmScript is string => typeof npmScript === 'string'),
  );
  for (const gateId of appliesTo.gateIds) {
    const gateNpmScript = gateNpmScriptsById.get(gateId);
    if (gateNpmScript !== undefined && !declaredNpmScripts.has(gateNpmScript)) {
      failures.push({
        index,
        path: `[${index}].appliesTo.npmScripts`,
        reason: `appliesTo gate npm script "${gateNpmScript}" for gate "${gateId}" must be listed in appliesTo.npmScripts.`,
      });
    }
  }
}

function validatePorts(
  ports: readonly CurrentResourceLockPort[] | undefined,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
  required: boolean,
): void {
  if (ports === undefined) {
    if (required) {
      failures.push({
        index,
        path: `[${index}].appliesTo.ports`,
        reason: 'port locks must declare specific ports or named port families.',
      });
    }
    return;
  }

  if (!Array.isArray(ports) || ports.length === 0) {
    failures.push({
      index,
      path: `[${index}].appliesTo.ports`,
      reason: 'port locks must declare specific ports or named port families.',
    });
    return;
  }

  for (const [portIndex, port] of ports.entries()) {
    if (!isRecord(port)) {
      failures.push({
        index,
        path: `[${index}].appliesTo.ports[${portIndex}]`,
        reason: 'port locks must declare specific ports or named port families.',
      });
      continue;
    }

    if (port.kind === 'port') {
      validateAllowedFields(
        port,
        PORT_FIELD_SETS.port,
        `appliesTo.ports[${portIndex}]`,
        'appliesTo.ports',
        index,
        failures,
      );
      validateOptionalString(port.label, `appliesTo.ports[${portIndex}].label`, index, failures);
      if (!Number.isInteger(port.value) || port.value <= 0 || port.value > 65535) {
        failures.push({
          index,
          path: `[${index}].appliesTo.ports[${portIndex}].value`,
          reason: 'port locks must declare specific ports or named port families.',
        });
      }
      continue;
    }

    if (port.kind === 'range') {
      validateAllowedFields(
        port,
        PORT_FIELD_SETS.range,
        `appliesTo.ports[${portIndex}]`,
        'appliesTo.ports',
        index,
        failures,
      );
      validateOptionalString(port.label, `appliesTo.ports[${portIndex}].label`, index, failures);
      const hasValidRangeBounds = Number.isInteger(port.start)
        && Number.isInteger(port.end)
        && port.start > 0
        && port.end <= 65535
        && port.start <= port.end;

      if (!hasValidRangeBounds) {
        failures.push({
          index,
          path: `[${index}].appliesTo.ports[${portIndex}]`,
          reason: 'port locks must declare specific ports or named port families.',
        });
        continue;
      }

      const rangeSize = port.end - port.start + 1;
      const hasAuditableLabel = typeof port.label === 'string' && port.label.trim().length > 0;
      if (rangeSize > MAX_PORT_RANGE_SIZE || !hasAuditableLabel) {
        failures.push({
          index,
          path: `[${index}].appliesTo.ports[${portIndex}]`,
          reason: 'port ranges must be narrow and auditable.',
        });
      }
      continue;
    }

    if (port.kind === 'family') {
      validateAllowedFields(
        port,
        PORT_FIELD_SETS.family,
        `appliesTo.ports[${portIndex}]`,
        'appliesTo.ports',
        index,
        failures,
      );
      validateOptionalString(port.label, `appliesTo.ports[${portIndex}].label`, index, failures);
      if (
        typeof port.name !== 'string'
        || port.name.trim().length === 0
        || GENERIC_LOCK_IDS.has(port.name)
      ) {
        failures.push({
          index,
          path: `[${index}].appliesTo.ports[${portIndex}].name`,
          reason: 'port locks must declare specific ports or named port families.',
        });
      }

      validatePortFamilyValuesOrPattern(port, portIndex, index, failures);
      continue;
    }

    validateAllowedFields(
      port,
      PORT_FIELD_SETS.unknown,
      `appliesTo.ports[${portIndex}]`,
      'appliesTo.ports',
      index,
      failures,
    );
    failures.push({
      index,
      path: `[${index}].appliesTo.ports[${portIndex}].kind`,
      reason: 'port locks must declare specific ports or named port families.',
    });
  }
}

function validatePathPattern(
  paths: readonly string[] | undefined,
  category: string,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  if (!Array.isArray(paths) || !paths.some((candidate) => candidate.includes('<') || candidate.includes('*'))) {
    failures.push({
      index,
      path: `[${index}].appliesTo.paths`,
      reason: `${category} locks must declare a path pattern.`,
    });
  }
}

function validateProfileReuse(
  profileReuse: unknown,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  if (!isRecord(profileReuse)) {
    failures.push({
      index,
      path: `[${index}].profileReuse`,
      reason: 'provider quota and secret profile locks must forbid cross provider/profile reuse.',
    });
    return;
  }

  validateAllowedFields(profileReuse, PROFILE_REUSE_FIELD_SET, 'profileReuse', 'profileReuse', index, failures);

  if (
    profileReuse.crossProviderProfileReuse !== 'forbidden'
    || profileReuse.crossSecretProfileReuse !== 'forbidden'
    || typeof profileReuse.reason !== 'string'
    || profileReuse.reason.trim().length === 0
  ) {
    failures.push({
      index,
      path: `[${index}].profileReuse`,
      reason: 'provider quota and secret profile locks must forbid cross provider/profile reuse.',
    });
  }
}

function validatePortFamilyValuesOrPattern(
  port: Extract<CurrentResourceLockPort, { kind: 'family' }>,
  portIndex: number,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  const hasValidValues = Array.isArray(port.values)
    && port.values.length > 0
    && port.values.every(isValidPortNumber);
  const hasAuditablePattern = typeof port.pattern === 'string' && port.pattern.trim().length > 0;

  if (port.values !== undefined && !hasValidValues) {
    failures.push({
      index,
      path: `[${index}].appliesTo.ports[${portIndex}].values`,
      reason: 'port families must declare specific values or an auditable pattern.',
    });
  }

  if (port.pattern !== undefined && !hasAuditablePattern) {
    failures.push({
      index,
      path: `[${index}].appliesTo.ports[${portIndex}].pattern`,
      reason: 'port families must declare specific values or an auditable pattern.',
    });
  }

  if (!hasValidValues && !hasAuditablePattern) {
    failures.push({
      index,
      path: `[${index}].appliesTo.ports[${portIndex}]`,
      reason: 'port families must declare specific values or an auditable pattern.',
    });
  }
}

function validateAllowedFields(
  record: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  pathPrefix: string,
  reasonScope: string,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  for (const key of Object.keys(record)) {
    if (allowedFields.has(key)) {
      continue;
    }

    failures.push({
      index,
      path: `[${index}].${pathPrefix}.${key}`,
      reason: `unknown ${reasonScope} field "${key}".`,
    });

    if (isCamelCaseKey(key)) {
      failures.push({
        index,
        path: `[${index}].${pathPrefix}.${key}`,
        reason: `camelCase ${reasonScope} key "${key}" is not allowed unless it is part of the resource lock schema.`,
      });
    }
  }
}

function validateOptionalString(
  value: unknown,
  pathSuffix: string,
  index: number,
  failures: CurrentResourceLockManifestFailure[],
): void {
  if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
    failures.push({
      index,
      path: `[${index}].${pathSuffix}`,
      reason: `${pathSuffix} must be a non-empty string when present.`,
    });
  }
}

function isValidPortNumber(value: unknown): value is number {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

function validateExpectedLockCoverage(
  seenIds: Set<string>,
  failures: CurrentResourceLockManifestFailure[],
): void {
  const missingIds = CURRENT_RESOURCE_LOCK_IDS.filter((id) => !seenIds.has(id));
  const unexpectedIds = [...seenIds].filter((id) => !EXPECTED_LOCK_ID_SET.has(id));

  if (missingIds.length > 0 || unexpectedIds.length > 0) {
    failures.push({
      index: -1,
      path: 'manifest.ids',
      reason: `manifest must cover exactly the current resource lock ids; missing=${missingIds.join(',') || 'none'} unexpected=${unexpectedIds.join(',') || 'none'}.`,
    });
  }
}

function hasAnyNonEmptyArray(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => Array.isArray(record[key]) && record[key].length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCamelCaseKey(key: string): boolean {
  return /^[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(key);
}
