import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findCurrentGateDefinitionById, listCurrentGateDefinitions } from '../current-gate-manifest';
import {
  CURRENT_RESOURCE_LOCK_MANIFEST,
  type CurrentResourceLockDefinition,
  type CurrentResourceLockPort,
  findCurrentResourceLockById,
  listCurrentResourceLocks,
  validateCurrentResourceLockManifest,
} from '../current-resource-lock-manifest';

const EXPECTED_LOCK_IDS = [
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

type FixedPort = Extract<CurrentResourceLockPort, { kind: 'port' }>;

function packageScripts(): Set<string> {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };

  return new Set(Object.keys(packageJson.scripts ?? {}));
}

function expectValidationFailure(manifest: readonly unknown[], expectedReason: string): void {
  const result = validateCurrentResourceLockManifest(manifest);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining(expectedReason),
        }),
      ]),
    );
  }
}

function replaceLock(
  id: string,
  replacement: (lock: CurrentResourceLockDefinition) => unknown,
): readonly unknown[] {
  return CURRENT_RESOURCE_LOCK_MANIFEST.map((lock) => (lock.id === id ? replacement(lock) : lock));
}

describe('current resource lock manifest', () => {
  it('covers the current P2 resource lock ids exactly once', () => {
    expect(CURRENT_RESOURCE_LOCK_MANIFEST.map((lock) => lock.id)).toEqual(EXPECTED_LOCK_IDS);

    const validation = validateCurrentResourceLockManifest();
    expect(validation).toEqual({
      ok: true,
      value: CURRENT_RESOURCE_LOCK_MANIFEST,
    });
  });

  it('keeps lock ids unique, stable kebab-case, and non-generic', () => {
    const ids = CURRENT_RESOURCE_LOCK_MANIFEST.map((lock) => lock.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(['', 'runtime', 'resource', 'lock', 'ports']).not.toContain(id);
    }

    expectValidationFailure(
      [
        ...CURRENT_RESOURCE_LOCK_MANIFEST,
        {
          ...CURRENT_RESOURCE_LOCK_MANIFEST[0],
          id: 'runtime',
        },
      ],
      'non-generic kebab-case',
    );
  });

  it('requires the structural top-level fields on every lock', () => {
    for (const lock of CURRENT_RESOURCE_LOCK_MANIFEST) {
      expect(lock.category).toBeTruthy();
      expect(lock.scope).toBeTruthy();
      expect(lock.mode).toBeTruthy();
      expect(lock.reason).toBeTruthy();
      expect(lock.owners).toBeTruthy();
      expect(lock.enforcement).toBeTruthy();
    }

    const [firstLock, ...restLocks] = CURRENT_RESOURCE_LOCK_MANIFEST;
    const withoutCategory: Record<string, unknown> = { ...firstLock };
    delete withoutCategory.category;
    expectValidationFailure([withoutCategory, ...restLocks], 'category is required');
  });

  it('validates appliesTo ports on every lock and requires concrete or auditable families', () => {
    const portLock = findCurrentResourceLockById('fixed-local-ports');

    expect(portLock?.category).toBe('port');
    expect(portLock?.appliesTo.ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'port', value: 20000 }),
        expect.objectContaining({ kind: 'family', name: 'scenario-sandbox-host-ports' }),
      ]),
    );

    expectValidationFailure(
      CURRENT_RESOURCE_LOCK_MANIFEST.map((lock) => (
        lock.id === 'fixed-local-ports'
          ? {
              ...lock,
              appliesTo: {
                ...lock.appliesTo,
                ports: ['ports'],
              },
            }
          : lock
      )),
      'specific ports or named port families',
    );

    expectValidationFailure(
      replaceLock('scenario-world', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          ports: [
            {
              kind: 'family',
              name: 'scenario-sandbox-host-ports',
            },
          ],
        },
      })),
      'specific values or an auditable pattern',
    );

    expectValidationFailure(
      replaceLock('scenario-world', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          ports: [
            {
              kind: 'family',
              name: 'ports',
              values: [29280],
            },
          ],
        },
      })),
      'specific ports or named port families',
    );

    expectValidationFailure(
      replaceLock('scenario-world', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          ports: [
            {
              kind: 'range',
              start: 3001,
              end: 3000,
            },
          ],
        },
      })),
      'specific ports or named port families',
    );

    expectValidationFailure(
      replaceLock('scenario-world', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          ports: [
            {
              kind: 'range',
              start: 1,
              end: 65535,
              label: 'all host ports',
            },
          ],
        },
      })),
      'port ranges must be narrow and auditable',
    );

    expectValidationFailure(
      replaceLock('scenario-world', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          ports: [
            {
              kind: 'range',
              start: 3000,
              end: 3010,
            },
          ],
        },
      })),
      'port ranges must be narrow and auditable',
    );
  });

  it('covers the known fixed local ports with auditable labels', () => {
    const portLock = findCurrentResourceLockById('fixed-local-ports');
    const fixedPorts = portLock?.appliesTo.ports?.filter((port): port is FixedPort => port.kind === 'port') ?? [];
    const portLabels = new Map(fixedPorts.map((port) => [port.value, port.label ?? '']));

    expect(portLabels.get(20000)).toContain('API');
    expect(portLabels.get(3000)).toContain('Web');
    expect(portLabels.get(3001)).toContain('Web');
    expect(portLabels.get(15432)).toContain('PG');
    expect(portLabels.get(17017)).toContain('Mongo');
    expect(portLabels.get(16379)).toContain('Redis');
    expect(portLabels.get(19000)).toContain('MinIO');
    expect(portLabels.get(19001)).toContain('MinIO');
    expect(portLabels.get(18080)).toContain('Keycloak');
    expect(portLabels.get(38080)).toContain('proxy');
    expect(portLock?.appliesTo.ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'family', name: 'scenario-sandbox-host-ports' }),
      ]),
    );
  });

  it('declares current alias paths for runtime lines, backend-real, and mock lane artifacts', () => {
    const aliasLock = findCurrentResourceLockById('runtime-current-aliases');

    expect(aliasLock?.appliesTo.paths).toEqual(
      expect.arrayContaining([
        'artifacts/runtime/lines/<runtime-line-id>/current/**',
        'artifacts/backend-real/current/**',
        'artifacts/backend-real/current-run/**',
        'artifacts/mock-lane/current/**',
      ]),
    );
  });

  it('requires mutable alias, campaign root, release pointer, scenario world, and visual baseline locks to declare path patterns', () => {
    for (const id of [
      'runtime-current-aliases',
      'release-latest-pointer',
      'release-campaign-root-writes',
      'scenario-world',
      'visual-baseline-update',
    ]) {
      const lock = findCurrentResourceLockById(id);

      expect(lock?.appliesTo.paths?.some((path) => path.includes('<') || path.includes('*'))).toBe(true);
    }

    expectValidationFailure(
      CURRENT_RESOURCE_LOCK_MANIFEST.map((lock) => (
        lock.id === 'release-latest-pointer'
          ? {
              ...lock,
              appliesTo: {
                ...lock.appliesTo,
                paths: ['artifacts/release-runs/latest.json'],
              },
            }
          : lock
      )),
      'path pattern',
    );

    expectValidationFailure(
      replaceLock('scenario-world', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          paths: ['scripts/scenarios/demo-rehearsal'],
        },
      })),
      'path pattern',
    );

    expectValidationFailure(
      replaceLock('visual-baseline-update', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          paths: ['e2e/__screenshots__/visual.spec.ts'],
        },
      })),
      'path pattern',
    );
  });

  it('requires provider quota and secret profile locks to forbid cross-profile reuse', () => {
    for (const id of ['backend-real-provider-quota', 'provider-secret-profile']) {
      const lock = findCurrentResourceLockById(id);

      expect(lock?.profileReuse).toMatchObject({
        crossProviderProfileReuse: 'forbidden',
        crossSecretProfileReuse: 'forbidden',
      });
      expect(lock?.profileReuse?.reason).toBeTruthy();
    }

    expectValidationFailure(
      CURRENT_RESOURCE_LOCK_MANIFEST.map((lock) => (
        lock.id === 'backend-real-provider-quota'
          ? {
              ...lock,
              profileReuse: {
                crossProviderProfileReuse: 'allowed',
                crossSecretProfileReuse: 'forbidden',
                reason: 'negative fixture',
              },
            }
          : lock
      )),
      'forbid cross provider/profile reuse',
    );
  });

  it('binds owner gate ids to the current gate manifest', () => {
    for (const lock of CURRENT_RESOURCE_LOCK_MANIFEST) {
      for (const gateId of lock.owners.gateIds ?? []) {
        expect(findCurrentGateDefinitionById(gateId), `${lock.id} owns unknown gate id ${gateId}`).toBeDefined();
      }
    }

    expectValidationFailure(
      CURRENT_RESOURCE_LOCK_MANIFEST.map((lock) => (
        lock.id === 'visual-baseline-update'
          ? {
              ...lock,
              owners: {
                ...lock.owners,
                gateIds: ['missing-gate'],
              },
            }
          : lock
      )),
      'unknown owner gate id',
    );
  });

  it('binds owner and appliesTo npm scripts to package.json scripts', () => {
    const scripts = packageScripts();

    for (const lock of CURRENT_RESOURCE_LOCK_MANIFEST) {
      for (const npmScript of lock.owners.npmScripts ?? []) {
        expect(scripts.has(npmScript), `${lock.id} owns unknown npm script ${npmScript}`).toBe(true);
      }
      for (const npmScript of lock.appliesTo.npmScripts ?? []) {
        expect(scripts.has(npmScript), `${lock.id} applies to unknown npm script ${npmScript}`).toBe(true);
      }
    }

    expectValidationFailure(
      CURRENT_RESOURCE_LOCK_MANIFEST.map((lock) => (
        lock.id === 'shared-local-substrate'
          ? {
              ...lock,
              appliesTo: {
                ...lock.appliesTo,
                npmScripts: ['missing:script'],
              },
            }
          : lock
      )),
      'unknown appliesTo npm script',
    );
  });

  it('requires appliesTo gate ids to list their current gate npm scripts', () => {
    const gatesById = new Map(listCurrentGateDefinitions().map((gate) => [gate.id, gate]));

    for (const lock of CURRENT_RESOURCE_LOCK_MANIFEST) {
      const appliesToGateIds = lock.appliesTo.gateIds ?? [];
      const appliesToScripts = new Set(lock.appliesTo.npmScripts ?? []);

      for (const gateId of appliesToGateIds) {
        const gate = gatesById.get(gateId);
        expect(gate, `${lock.id} applies to unknown gate id ${gateId}`).toBeDefined();
        expect(
          appliesToScripts.has(gate?.npmScript ?? ''),
          `${lock.id} appliesTo.gateIds includes ${gateId} but omits ${gate?.npmScript}`,
        ).toBe(true);
      }
    }

    expectValidationFailure(
      replaceLock('fixed-local-ports', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          npmScripts: lock.appliesTo.npmScripts?.filter((script) => script !== 'test:backend-real:core'),
        },
      })),
      'appliesTo gate npm script',
    );

    expectValidationFailure(
      replaceLock('fixed-local-ports', (lock) => {
        const appliesTo: Record<string, unknown> = { ...lock.appliesTo };
        delete appliesTo.npmScripts;

        return {
          ...lock,
          appliesTo,
        };
      }),
      'appliesTo gate npm script',
    );

    expectValidationFailure(
      replaceLock('fixed-local-ports', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          npmScripts: [],
        },
      })),
      'appliesTo gate npm script',
    );
  });

  it('fails closed on unknown top-level fields and camelCase top-level keys', () => {
    expectValidationFailure(
      [
        {
          ...CURRENT_RESOURCE_LOCK_MANIFEST[0],
          unknownField: true,
        },
        ...CURRENT_RESOURCE_LOCK_MANIFEST.slice(1),
      ],
      'unknown top-level field',
    );

    expectValidationFailure(
      [
        {
          ...CURRENT_RESOURCE_LOCK_MANIFEST[0],
          resourceLockId: CURRENT_RESOURCE_LOCK_MANIFEST[0].id,
        },
        ...CURRENT_RESOURCE_LOCK_MANIFEST.slice(1),
      ],
      'camelCase top-level key',
    );
  });

  it('fails closed on unknown nested fields and unknown nested camelCase keys', () => {
    expectValidationFailure(
      replaceLock('next-source-contract', (lock) => ({
        ...lock,
        owners: {
          ...lock.owners,
          ownerGateIds: ['governance-default'],
        },
      })),
      'unknown owners field',
    );

    expectValidationFailure(
      replaceLock('next-source-contract', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          pathGlobs: ['src/**/*'],
        },
      })),
      'unknown appliesTo field',
    );

    expectValidationFailure(
      replaceLock('backend-real-provider-quota', (lock) => ({
        ...lock,
        profileReuse: {
          ...lock.profileReuse,
          providerProfileReuse: 'forbidden',
        },
      })),
      'unknown profileReuse field',
    );

    expectValidationFailure(
      replaceLock('scenario-world', (lock) => ({
        ...lock,
        appliesTo: {
          ...lock.appliesTo,
          ports: [
            {
              kind: 'family',
              name: 'scenario-sandbox-host-ports',
              values: [29280, 29080],
              hostPorts: true,
            },
          ],
        },
      })),
      'unknown appliesTo.ports field',
    );
  });

  it('lists and finds current resource locks without mutating the manifest', () => {
    expect(listCurrentResourceLocks()).toBe(CURRENT_RESOURCE_LOCK_MANIFEST);
    expect(findCurrentResourceLockById('scenario-world')?.id).toBe('scenario-world');
    expect(findCurrentResourceLockById('missing-lock')).toBeUndefined();
  });
});
