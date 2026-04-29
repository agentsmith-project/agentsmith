import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateCurrentRehearsalWorldHealthSnapshot } from '../current-rehearsal-world-health-schema';
import {
  buildRehearsalWorldHealthSnapshot,
  renderRehearsalWorldHealthSnapshot,
} from '../rehearsal-world-health';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function writeJson(path: string, payload: unknown): void {
  writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function seedDemoFlow(root: string): void {
  writeFile(join(root, 'infra', 'flows', 'demo-rehearsal.env'), [
    'LOCAL_KIND_CLUSTER_NAME=agentsmith-demo',
    'LOCAL_KIND_REGISTRY_NAME=agentsmith-demo-registry',
    'LOCAL_KIND_REGISTRY_HOST=127.0.0.1',
    'LOCAL_KIND_REGISTRY_HOST_PORT=5003',
    'FLOW_SITE_ENV_WEB_PORT=33001',
    'FLOW_SITE_ENV_API_PORT=40000',
    'FLOW_SITE_ENV_KEYCLOAK_PORT=38080',
    'FLOW_SITE_ENV_SANDBOX_HOST_PORT=29280',
    'FLOW_SITE_ENV_PUBLIC_WEB_BASE_URL=http://localhost:33001',
    'FLOW_SITE_ENV_PUBLIC_API_BASE_URL=http://localhost:40000',
    'FLOW_SITE_ENV_PUBLIC_KEYCLOAK_BASE_URL=http://localhost:38080',
  ].join('\n') + '\n');
}

function seedClusterFlow(root: string): void {
  writeFile(join(root, 'infra', 'flows', 'cluster-rehearsal.env'), [
    'LOCAL_KIND_CLUSTER_NAME=agentsmith-cluster',
    'LOCAL_KIND_REGISTRY_NAME=agentsmith-cluster-registry',
    'LOCAL_KIND_REGISTRY_HOST=127.0.0.1',
    'LOCAL_KIND_REGISTRY_HOST_PORT=5002',
    'CLUSTER_REHEARSAL_REGISTRY_HOST=localhost:5002',
    'FLOW_SITE_ENV_WEB_PORT=43001',
    'FLOW_SITE_ENV_API_PORT=41000',
    'FLOW_SITE_ENV_KEYCLOAK_PORT=48080',
    'FLOW_SITE_ENV_SANDBOX_HOST_PORT=29080',
    'FLOW_SITE_ENV_PUBLIC_WEB_BASE_URL=http://localhost:43001',
    'FLOW_SITE_ENV_PUBLIC_API_BASE_URL=http://localhost:41000/api/v1',
    'FLOW_SITE_ENV_PUBLIC_KEYCLOAK_BASE_URL=http://localhost:48080',
  ].join('\n') + '\n');
}

function seedActiveScenario(root: string, scenario: string, scenarioRoot: string): void {
  const runtimeRoot = join(root, 'artifacts', 'runtime');
  writeFile(join(runtimeRoot, 'active-scenario.lock'), `${scenario}\n`);
  writeFile(join(runtimeRoot, 'active-scenario.env'), `SCENARIO=${scenario}\nSCENARIO_ROOT=${scenarioRoot}\n`);
}

function withTempRoot<T>(action: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'agentsmith-world-health-'));
  try {
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectNoSnapshotSecretLeak(value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  expect(serialized).not.toContain('world-health-query-token');
  expect(serialized).not.toContain('world-health-raw-secret');
  expect(serialized).not.toContain('world-health-ticket');
  expect(serialized).not.toContain('Bearer world-health-bearer');
}

describe('rehearsal world health snapshot', () => {
  it('reports a healthy demo world from phase, service, cluster, registry, and public base truth', () => {
    withTempRoot((root) => {
      seedDemoFlow(root);
      const scenarioRoot = join(root, 'artifacts', 'runtime', 'scenario', 'demo-rehearsal');
      seedActiveScenario(root, 'demo-rehearsal', scenarioRoot);
      writeJson(join(scenarioRoot, 'state', 'deploy-state.json'), {
        release: {
          phase: 'verify_completed',
          id: 'demo-release-healthy',
        },
      });
      writeFile(join(scenarioRoot, 'config', 'site.env'), [
        'WEB_PORT=33001',
        'API_PORT=40000',
        'KEYCLOAK_PORT=38080',
        'SANDBOX_HOST_PORT=29280',
        'PUBLIC_WEB_BASE_URL=http://localhost:33001',
        'PUBLIC_API_BASE_URL=http://localhost:40000',
        'PUBLIC_KEYCLOAK_BASE_URL=http://localhost:38080',
      ].join('\n') + '\n');
      mkdirSync(join(scenarioRoot, 'current'), { recursive: true });

      const snapshot = buildRehearsalWorldHealthSnapshot({
        runtimeLine: 'demo-rehearsal',
        rootDir: root,
        scenarioRoot,
        runtimeRoot: join(root, 'artifacts', 'runtime'),
        generatedAt: GENERATED_AT,
        env: {
          REHEARSAL_MODE: 'release-fidelity',
          AGENTSMITH_REHEARSAL_KIND_CLUSTER_PRESENT: 'present',
          AGENTSMITH_REHEARSAL_REGISTRY_PRESENT: 'present',
          AGENTSMITH_REHEARSAL_WEB_STATUS: '200',
          AGENTSMITH_REHEARSAL_API_STATUS: '200',
          AGENTSMITH_REHEARSAL_KEYCLOAK_STATUS: '200',
          AGENTSMITH_REHEARSAL_SANDBOX_STATUS: '200',
        },
      });

      expect(validateCurrentRehearsalWorldHealthSnapshot(snapshot)).toMatchObject({ ok: true });
      expect(snapshot).toMatchObject({
        schema: 'agentsmith_rehearsal_world_health_snapshot/v1',
        projection_kind: 'read_only_rehearsal_world_health_snapshot',
        runtime_line: 'demo-rehearsal',
        rehearsal_mode: 'release-fidelity',
        health_status: 'healthy',
        safe_reset_level: 'none',
        safe_next_command: 'npm run rehearse:demo',
        diagnostic_only: true,
        mutates_world: false,
      });
      expect(snapshot.world_identity).toMatchObject({
        active_scenario: 'demo-rehearsal',
        phase: 'verify_completed',
        release_id: 'demo-release-healthy',
        public_bases: {
          web: 'http://localhost:33001',
          api: 'http://localhost:40000',
          keycloak: 'http://localhost:38080',
        },
        ports: {
          web: 33001,
          api: 40000,
          keycloak: 38080,
          sandbox: 29280,
          registry: 5003,
        },
        kind_cluster: {
          name: 'agentsmith-demo',
          present: 'present',
        },
        registry: {
          name: 'agentsmith-demo-registry',
          host: '127.0.0.1',
          host_port: 5003,
          present: 'present',
        },
      });
    });
  });

  it('recommends a world reset before rerun when the world is active but service health is degraded', () => {
    withTempRoot((root) => {
      seedClusterFlow(root);
      const scenarioRoot = join(root, 'artifacts', 'runtime', 'scenario', 'cluster-rehearsal');
      seedActiveScenario(root, 'cluster-rehearsal', scenarioRoot);
      writeJson(join(scenarioRoot, 'state', 'deploy-state.json'), {
        release: {
          phase: 'deploy_app_completed',
          id: 'cluster-release-degraded',
        },
      });

      const snapshot = buildRehearsalWorldHealthSnapshot({
        runtimeLine: 'cluster-rehearsal',
        rootDir: root,
        scenarioRoot,
        runtimeRoot: join(root, 'artifacts', 'runtime'),
        generatedAt: GENERATED_AT,
        env: {
          REHEARSAL_MODE: 'offline-package',
          AGENTSMITH_REHEARSAL_KIND_CLUSTER_PRESENT: 'present',
          AGENTSMITH_REHEARSAL_REGISTRY_PRESENT: 'present',
          AGENTSMITH_REHEARSAL_WEB_STATUS: 'inactive',
          AGENTSMITH_REHEARSAL_API_STATUS: '000',
          AGENTSMITH_REHEARSAL_KEYCLOAK_STATUS: '200',
          AGENTSMITH_REHEARSAL_SANDBOX_STATUS: 'skipped',
        },
      });

      expect(validateCurrentRehearsalWorldHealthSnapshot(snapshot)).toMatchObject({ ok: true });
      expect(snapshot.health_status).toBe('degraded');
      expect(snapshot.safe_reset_level).toBe('world');
      expect(snapshot.safe_next_command).toBe('make cluster-rehearsal-reset && npm run rehearse:cluster');
      expect(snapshot.safe_reset_reason).toContain('web service health is inactive');
      expect(snapshot.safe_reset_reason).toContain('api service health is unhealthy');
      expect(JSON.stringify(snapshot)).not.toMatch(/SKIP_|skip_invalidation|claim_id|failure_class|verdict/);
    });
  });

  it('does not treat an empty directory as reusable health', () => {
    withTempRoot((root) => {
      seedDemoFlow(root);
      const scenarioRoot = join(root, 'artifacts', 'runtime', 'scenario', 'demo-rehearsal');
      mkdirSync(scenarioRoot, { recursive: true });

      const snapshot = buildRehearsalWorldHealthSnapshot({
        runtimeLine: 'demo-rehearsal',
        rootDir: root,
        scenarioRoot,
        runtimeRoot: join(root, 'artifacts', 'runtime'),
        generatedAt: GENERATED_AT,
        env: {
          REHEARSAL_MODE: 'fast',
        },
      });

      expect(snapshot.health_status).toBe('missing');
      expect(snapshot.safe_reset_level).toBe('none');
      expect(snapshot.safe_next_command).toBe('npm run rehearse:demo');
      expect(snapshot.world_identity.kind_cluster.present).toBe('unknown');
      expect(snapshot.world_identity.registry.present).toBe('unknown');
      expect(snapshot.component_health.state_file).toBe('absent');
    });
  });

  it('redacts secret-like values from URLs, paths, and rendered output', () => {
    withTempRoot((plainRoot) => {
      const root = join(plainRoot, 'world-health-api_key=world-health-raw-secret');
      seedDemoFlow(root);
      const scenarioRoot = join(root, 'artifacts', 'runtime', 'scenario', 'demo-rehearsal');
      seedActiveScenario(root, 'demo-rehearsal', scenarioRoot);
      writeJson(join(scenarioRoot, 'state', 'deploy-state.json'), {
        release: {
          phase: 'verify_completed',
          id: 'Bearer world-health-bearer',
        },
      });
      writeFile(join(scenarioRoot, 'config', 'site.env'), [
        'PUBLIC_WEB_BASE_URL=http://localhost:33001?access_token=world-health-query-token',
        'PUBLIC_API_BASE_URL=http://localhost:40000/api/v1?ticket=world-health-ticket',
        'PRESET_ENDPOINT_API_KEY=sk-world-health-raw-secret',
      ].join('\n') + '\n');

      const snapshot = buildRehearsalWorldHealthSnapshot({
        runtimeLine: 'demo-rehearsal',
        rootDir: root,
        scenarioRoot,
        runtimeRoot: join(root, 'artifacts', 'runtime'),
        generatedAt: GENERATED_AT,
        env: {
          REHEARSAL_MODE: 'release-fidelity',
          AGENTSMITH_REHEARSAL_WEB_STATUS: '200',
          AGENTSMITH_REHEARSAL_API_STATUS: '200',
          AGENTSMITH_REHEARSAL_KEYCLOAK_STATUS: '200',
          AGENTSMITH_REHEARSAL_SANDBOX_STATUS: '200',
        },
      });
      const rendered = renderRehearsalWorldHealthSnapshot(snapshot);

      expect(validateCurrentRehearsalWorldHealthSnapshot(snapshot)).toMatchObject({ ok: true });
      expect(snapshot.world_identity.public_bases.web).toBe('http://localhost:33001/');
      expect(snapshot.world_identity.public_bases.api).toBe('http://localhost:40000/api/v1');
      expect(snapshot.world_identity.release_id).toBe('[redacted]');
      expect(JSON.stringify(snapshot)).toContain('[redacted]');
      expect(rendered).toContain('AgentSmith Rehearsal World Health');
      expect(rendered).not.toMatch(/verdict|failure_class|claim_id|release_decision/);
      expectNoSnapshotSecretLeak(snapshot);
      expectNoSnapshotSecretLeak(rendered);
    });
  });

  it('renders a compact human snapshot with authority paths and safe reset recommendation', () => {
    withTempRoot((root) => {
      seedClusterFlow(root);
      const scenarioRoot = join(root, 'artifacts', 'runtime', 'scenario', 'cluster-rehearsal');
      seedActiveScenario(root, 'cluster-rehearsal', scenarioRoot);
      writeJson(join(scenarioRoot, 'state', 'deploy-state.json'), {
        release: {
          phase: 'deploy_app_completed',
          id: 'cluster-release-render',
        },
      });

      const snapshot = buildRehearsalWorldHealthSnapshot({
        runtimeLine: 'cluster-rehearsal',
        rootDir: root,
        scenarioRoot,
        runtimeRoot: join(root, 'artifacts', 'runtime'),
        generatedAt: GENERATED_AT,
        env: {
          REHEARSAL_MODE: 'release-fidelity',
          AGENTSMITH_REHEARSAL_KIND_CLUSTER_PRESENT: 'present',
          AGENTSMITH_REHEARSAL_REGISTRY_PRESENT: 'absent',
          AGENTSMITH_REHEARSAL_WEB_STATUS: '503',
          AGENTSMITH_REHEARSAL_API_STATUS: '200',
          AGENTSMITH_REHEARSAL_KEYCLOAK_STATUS: '200',
          AGENTSMITH_REHEARSAL_SANDBOX_STATUS: '200',
        },
      });
      const rendered = renderRehearsalWorldHealthSnapshot(snapshot);

      expect(rendered).toContain('AgentSmith Rehearsal World Health');
      expect(rendered).toContain('Runtime line: cluster-rehearsal');
      expect(rendered).toContain('Health: degraded');
      expect(rendered).toContain('Registry: agentsmith-cluster-registry @ 127.0.0.1:5002 (absent)');
      expect(rendered).toContain('Safe reset level: world');
      expect(rendered).toContain('Safe next command: make cluster-rehearsal-reset && npm run rehearse:cluster');
      expect(rendered).toContain('Authority:');
      expect(rendered).toContain('read-only diagnostics');
      expect(rendered).not.toMatch(/verdict|failure_class|claim_id|release_decision/);
      expect(readFileSync(snapshot.authority_paths.state_file, 'utf8')).toContain('cluster-release-render');
    });
  });
});
