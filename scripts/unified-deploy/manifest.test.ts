import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkUnifiedDeployManifest } from './check-manifest';

const fixtureRoots: string[] = [];

function fixtureRoot(manifest: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'unified-deploy-manifest-'));
  fixtureRoots.push(root);
  mkdirSync(join(root, 'infra', 'deploy', 'unified'), { recursive: true });
  writeFileSync(
    join(root, 'infra', 'deploy', 'unified', 'deployment.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('unified deploy manifest producer', () => {
  it('accepts the repository manifest as the offline deploy topology contract', () => {
    const result = checkUnifiedDeployManifest();

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('requires exactly the two target profiles and the Docker-only substrate members', () => {
    const root = fixtureRoot({
      schema_version: 'agentsmith.unified-deploy.manifest/v1',
      deploy_model: 'AgentSmith deploy',
      profiles: {
        'local-kind': {},
        'existing-cluster': {},
        'bring-your-own-substrate': {},
      },
      substrate: {
        implementation: 'kubernetes',
        services: ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak', 'llmup'],
      },
      app: {
        components: {
          web: {},
          api: { replicas: 2 },
          llmup: {},
          'sandbox-manager': {},
          'managed-runner-support': {},
        },
      },
      ingress: {
        routes: [],
        internal_only_services: [],
      },
      guards: {
        forbidden_env: ['API_REPLICAS'],
        forbidden_resource_names: [],
        forbidden_autoscaler_kinds: [],
      },
      templates: {
        app: [],
      },
    });

    const text = checkUnifiedDeployManifest({ rootDir: root }).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('profiles must be exactly local-kind and existing-cluster');
    expect(text).toContain('substrate implementation must be docker-only');
    expect(text).toContain('substrate services must be exactly postgresql, mongodb, redis, minio, keycloak');
    expect(text).toContain('api component must declare replicas=1');
  });

  it('rejects execution-gateway, API_REPLICAS settings, public llmup routing, app cluster-scoped RBAC, and missing route owners', () => {
    const root = fixtureRoot({
      schema_version: 'agentsmith.unified-deploy.manifest/v1',
      deploy_model: 'AgentSmith deploy',
      profiles: {
        'local-kind': {},
        'existing-cluster': {},
      },
      substrate: {
        implementation: 'docker-only',
        services: ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'],
      },
      app: {
        components: {
          web: {},
          api: { replicas: 1, operator_replicas_setting: 'API_REPLICAS' },
          llmup: {},
          'sandbox-manager': {},
          'managed-runner-support': {},
          'execution-gateway': {},
        },
      },
      ingress: {
        routes: [
          { path: '/api/v1', service: 'execution-gateway' },
          { path: '/api/public', service: 'api' },
          { path: '/api/system', service: 'api' },
          { path: '/', service: 'web' },
          { path: '/llmup', service: 'llmup' },
        ],
        internal_only_services: [],
      },
      guards: {
        forbidden_env: [],
        forbidden_resource_names: [],
        forbidden_autoscaler_kinds: [],
      },
      templates: {
        app: ['templates/app/namespace.yaml.tpl', 'templates/app/rbac.yaml.tpl', 'templates/app/workloads.yaml.tpl'],
        local_kind_admin_preflight: [],
      },
    });
    mkdirSync(join(root, 'infra', 'deploy', 'unified', 'templates', 'app'), { recursive: true });
    writeFileSync(
      join(root, 'infra', 'deploy', 'unified', 'templates', 'app', 'rbac.yaml.tpl'),
      'apiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRole\nmetadata:\n  name: app-owned-cluster-role\n',
      'utf8',
    );

    const text = checkUnifiedDeployManifest({ rootDir: root }).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('manifest must not declare execution-gateway');
    expect(text).toContain('api must not expose an operator replicas setting');
    expect(text).toContain('guards must forbid API_REPLICAS');
    expect(text).toContain('/api/v1 must route to api');
    expect(text).toContain('/api/public must route to web');
    expect(text).toContain('/api/system must route to web');
    expect(text).toContain('llmup must be internal only');
    expect(text).toContain('app templates must not include Namespace resources');
    expect(text).toContain('app templates must not include cluster-scoped RBAC resources');
  });
});
