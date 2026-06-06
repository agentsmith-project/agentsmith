import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectFixedLocalPreflightPorts,
  renderResourceOwnerPreflightSummary,
  runResourceOwnerPreflight,
  type ResourceOwnerPreflightCommand,
  type ResourceOwnerPreflightCommandResult,
} from '../resource-owner-preflight';

function ok(stdout = ''): ResourceOwnerPreflightCommandResult {
  return { exitCode: 0, stdout, stderr: '' };
}

function fail(stderr = ''): ResourceOwnerPreflightCommandResult {
  return { exitCode: 1, stdout: '', stderr };
}

function dockerInspectRecord(input: {
  name: string;
  project?: string;
  service?: string;
  hostPort: number;
  containerPort: number;
  image?: string;
  labels?: Record<string, string>;
}): string {
  return dockerInspectRecords([input]);
}

function dockerInspectRecords(inputs: readonly {
  name: string;
  project?: string;
  service?: string;
  hostPort: number;
  containerPort: number;
  image?: string;
  labels?: Record<string, string>;
}[]): string {
  return JSON.stringify(inputs.map((input) => ({
    Name: `/${input.name}`,
    Config: {
      Image: input.image ?? `${input.project ?? 'unknown'}/${input.service ?? input.name}:test`,
      Labels: {
        ...(input.project ? { 'com.docker.compose.project': input.project } : {}),
        ...(input.service ? { 'com.docker.compose.service': input.service } : {}),
        ...(input.labels ?? {}),
      },
    },
    NetworkSettings: {
      Ports: {
        [`${input.containerPort}/tcp`]: [
          {
            HostIp: '0.0.0.0',
            HostPort: String(input.hostPort),
          },
        ],
      },
    },
  })));
}

function writeLocalRealSubstrateState(root: string): void {
  const stateRoot = join(root, 'artifacts', 'runtime', 'substrate', 'local-dev');
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(join(stateRoot, 'status.json'), `${JSON.stringify({
    substrate: 'local-dev',
    type: 'compose',
    connection_env: true,
    proxy_ready: false,
    updated_at: '2026-05-13T00:00:00Z',
  })}\n`);
}

function expectFailed(
  result: ReturnType<typeof runResourceOwnerPreflight>,
): Extract<ReturnType<typeof runResourceOwnerPreflight>, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected preflight conflict');
  }
  return result;
}

function expectNoSensitiveEvidence(value: string): void {
  for (const secret of [
    'secret-token-value',
    'sk-test-api-key-value',
    'runner-ticket-value',
    'client-secret-value',
  ]) {
    expect(value).not.toContain(secret);
  }
  expect(value).not.toMatch(/--token|api-key|ticket|client-secret/iu);
}

function commandKey(command: ResourceOwnerPreflightCommand): string {
  return [command.executable, ...command.args].join(' ');
}

describe('resource owner preflight', () => {
  it('collects fixed local ports from the current resource lock manifest including port families', () => {
    expect(collectFixedLocalPreflightPorts()).toEqual(expect.arrayContaining([
      expect.objectContaining({ port: 20000 }),
      expect.objectContaining({ port: 27027 }),
      expect.objectContaining({ port: 5001, family: 'unified-deploy-local-registry-host-ports' }),
      expect.objectContaining({ port: 29180, family: 'unified-deploy-local-kind-ingress-host-ports' }),
    ]));
  });

  it('maps a unified-deploy substrate Docker owner to the substrate lifecycle cleanup command', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-resource-owner-preflight-'));
    const calls: string[] = [];
    try {
      const evidencePath = join(root, 'preflight', 'evidence.json');
      const result = runResourceOwnerPreflight({
        target: 'release-ready',
        evidencePath,
        runner: (command) => {
          calls.push(commandKey(command));
          if (command.executable === 'docker' && command.args.join(' ') === 'ps -q') {
            return ok('unified-mongo-id\n');
          }
          if (command.executable === 'docker' && command.args[0] === 'inspect') {
            return ok(dockerInspectRecord({
              name: 'agentsmith-unified-substrate-mongodb-1',
              project: 'agentsmith-unified-substrate',
              service: 'mongodb',
              hostPort: 27027,
              containerPort: 27017,
            }));
          }
          return fail('not found');
        },
      });

      const failed = expectFailed(result);
      expect(failed.blocker).toMatchObject({
        port: 27027,
        owner_kind: 'unified-deploy-substrate',
        owner_label: 'agentsmith-unified-substrate-mongodb-1',
        recovery: {
          kind: 'fix',
          command: 'npx tsx scripts/unified-deploy/substrate-lifecycle.ts down',
        },
      });
      expect(calls).toContain('docker ps -q');
      expect(existsSync(evidencePath)).toBe(true);
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
        status: string;
        blocker: { port: number; owner_kind: string } | null;
      };
      expect(evidence).toMatchObject({
        status: 'failed',
        blocker: {
          port: 27027,
          owner_kind: 'unified-deploy-substrate',
        },
      });

      const rendered = renderResourceOwnerPreflightSummary(result, {
        title: 'AgentSmith Product Readiness',
        rerunCommand: 'npm run product:ready',
      });
      expect(rendered.trim().split('\n')).toHaveLength(8);
      expect(rendered).toContain('Blocker: environment_conflict');
      expect(rendered).toContain('Stage: preflight');
      expect(rendered).toContain('Why: port 27027 is owned by agentsmith-unified-substrate-mongodb-1');
      expect(rendered).toContain('Fix: npx tsx scripts/unified-deploy/substrate-lifecycle.ts down');
      expect(rendered).toContain('Rerun: npm run product:ready');
      expect(rendered).not.toContain('Rerun: npm run release:ready');
      expect(rendered).toContain(`Evidence: ${evidencePath}`);
      expect(failed.blocker.owner_kind).toBe('unified-deploy-substrate');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the local-real substrate marker before treating shared compose ports as integration deps', () => {
    const result = runResourceOwnerPreflight({
      target: 'verify-real',
      runner: (command) => {
        if (command.executable === 'docker' && command.args.join(' ') === 'ps -q') {
          return ok('mbos-postgres-id\nlocal-real-proxy-id\n');
        }
        if (command.executable === 'docker' && command.args[0] === 'inspect') {
          return ok(dockerInspectRecords([
            {
              name: 'mbos-postgres',
              project: 'mbos-integration-deps',
              service: 'postgres',
              hostPort: 15432,
              containerPort: 5432,
            },
            {
              name: 'agentsmith-substrate-local-dev-universal-proxy',
              hostPort: 38080,
              containerPort: 8080,
              image: 'ghcr.io/agent-smith/universal-proxy:test',
              labels: {
                'com.agentsmith.managed-by': 'universal-proxy-runtime',
                'com.agentsmith.runtime-label': 'substrate-local-dev',
              },
            },
          ]));
        }
        return fail('not found');
      },
    });

    const failed = expectFailed(result);
    expect(failed.blocker).toMatchObject({
      port: 15432,
      owner_kind: 'local-real-substrate',
      recovery: {
        kind: 'fix',
        command: 'make substrate-down',
      },
    });
  });

  it('keeps shared compose ports inspect-only when local-real substrate ownership is ambiguous', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-resource-owner-preflight-'));
    try {
      writeLocalRealSubstrateState(root);
      const result = runResourceOwnerPreflight({
        target: 'verify-real',
        cwd: root,
        runner: (command) => {
          if (command.executable === 'docker' && command.args.join(' ') === 'ps -q') {
            return ok('mbos-postgres-id\n');
          }
          if (command.executable === 'docker' && command.args[0] === 'inspect') {
            return ok(dockerInspectRecord({
              name: 'mbos-postgres',
              project: 'mbos-integration-deps',
              service: 'postgres',
              hostPort: 15432,
              containerPort: 5432,
            }));
          }
          return fail('not found');
        },
      });

      const failed = expectFailed(result);
      expect(failed.blocker).toMatchObject({
        port: 15432,
        owner_kind: 'unknown',
        recovery: {
          kind: 'inspect',
          command: 'lsof -nP -iTCP:15432 -sTCP:LISTEN',
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('maps integration deps, local-real app, local-real substrate, and inspect-only owners to their actual recovery surface', () => {
    const cases = [
      {
        name: 'mbos-postgres',
        project: 'mbos-integration-deps',
        service: 'postgres',
        hostPort: 15432,
        containerPort: 5432,
        ownerKind: 'integration-deps',
        recoveryKind: 'fix',
        command: 'npm run integration:deps:down',
      },
      {
        name: 'agentsmith-substrate-local-dev-universal-proxy',
        project: 'agentsmith-substrate-local-dev',
        service: 'universal-proxy',
        hostPort: 38080,
        containerPort: 8080,
        ownerKind: 'local-real-substrate',
        recoveryKind: 'fix',
        command: 'make substrate-down',
      },
      {
        name: 'kind-registry',
        project: 'kind-registry',
        service: 'registry',
        hostPort: 5001,
        containerPort: 5000,
        ownerKind: 'kind-local-registry',
        recoveryKind: 'fix',
        command: 'make local-real-down',
      },
    ] as const;

    const cleanRuntimeRoot = mkdtempSync(join(tmpdir(), 'agentsmith-resource-owner-preflight-'));
    try {
      for (const testCase of cases) {
        const result = runResourceOwnerPreflight({
          target: 'local-real-up',
          cwd: cleanRuntimeRoot,
          runner: (command) => {
            if (command.executable === 'docker' && command.args.join(' ') === 'ps -q') {
              return ok(`${testCase.name}-id\n`);
            }
            if (command.executable === 'docker' && command.args[0] === 'inspect') {
              return ok(dockerInspectRecord(testCase));
            }
            return fail('not found');
          },
        });

        const failed = expectFailed(result);
        expect(failed.blocker.owner_kind).toBe(testCase.ownerKind);
        expect(failed.blocker.recovery).toMatchObject({
          kind: testCase.recoveryKind,
          command: testCase.command,
        });
      }
    } finally {
      rmSync(cleanRuntimeRoot, { recursive: true, force: true });
    }

    const localRealApp = runResourceOwnerPreflight({
      target: 'local-real-up',
      runner: (command) => {
        if (command.executable === 'docker') {
          return command.args[0] === 'ps' ? ok('') : fail('not found');
        }
        if (command.executable === 'lsof' && command.args.includes('-iTCP:20000')) {
          return ok('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 4242 percy 20u IPv4 1 0t0 TCP *:20000 (LISTEN)\n');
        }
        if (command.executable === 'ps') {
          return ok('node scripts/local-manual/start-api.js\n');
        }
        return fail('not found');
      },
    });

    const failedLocalRealApp = expectFailed(localRealApp);
    expect(failedLocalRealApp.blocker.owner_kind).toBe('local-real-app');
    expect(failedLocalRealApp.blocker.recovery).toEqual({
      kind: 'fix',
      command: 'make local-real-down',
    });
  });

  it('keeps unknown owners inspect-only instead of inventing cleanup', () => {
    const result = runResourceOwnerPreflight({
      target: 'verify-real',
      runner: (command) => {
        if (command.executable === 'docker') {
          return command.args[0] === 'ps' ? ok('') : fail('not found');
        }
        if (command.executable === 'lsof' && command.args.includes('-iTCP:3000')) {
          return ok('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\npython 111 percy 20u IPv4 1 0t0 TCP *:3000 (LISTEN)\n');
        }
        if (command.executable === 'ps') {
          return ok('python -m http.server 3000\n');
        }
        return fail('not found');
      },
    });

    const failed = expectFailed(result);
    expect(failed.blocker.owner_kind).toBe('unknown');
    expect(failed.blocker.recovery).toEqual({
      kind: 'inspect',
      command: 'lsof -nP -iTCP:3000 -sTCP:LISTEN',
    });
  });

  it('redacts secret-like process command values before writing evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-resource-owner-preflight-'));
    try {
      const evidencePath = join(root, 'preflight', 'evidence.json');
      const result = runResourceOwnerPreflight({
        target: 'local-real-up',
        evidencePath,
        runner: (command) => {
          if (command.executable === 'docker') {
            return command.args[0] === 'ps' ? ok('') : fail('not found');
          }
          if (command.executable === 'lsof' && command.args.includes('-iTCP:20000')) {
            return ok('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 4242 percy 20u IPv4 1 0t0 TCP *:20000 (LISTEN)\n');
          }
          if (command.executable === 'ps') {
            return ok(
              'node scripts/local-manual/start-api.js --token=secret-token-value --api-key sk-test-api-key-value --ticket runner-ticket-value --client-secret=client-secret-value\n',
            );
          }
          return fail('not found');
        },
      });

      const failed = expectFailed(result);
      expect(failed.blocker.owner_kind).toBe('local-real-app');
      expectNoSensitiveEvidence(JSON.stringify(failed.evidence));
      const evidenceText = readFileSync(evidencePath, 'utf8');
      expectNoSensitiveEvidence(evidenceText);
      expect(evidenceText).toContain('[redacted]');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
