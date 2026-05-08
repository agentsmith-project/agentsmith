import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SUBSTRATE_INTERNAL_NO_PROXY_HOSTS,
  DEFAULT_SUBSTRATE_TRUTH_OUTPUT_PATH,
  type SubstrateCommandInvocation,
  type SubstrateCommandResult,
  type SubstrateLifecycleCommand,
  buildSubstrateInternalNoProxy,
  buildSubstrateTruthText,
  runSubstrateLifecycle,
} from './substrate-lifecycle';
import {
  SUBSTRATE_TRUTH_SCHEMA_VERSION,
  validateSubstrateTruthText,
} from './substrate-truth';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'unified-substrate-lifecycle-'));
  tempRoots.push(root);
  return root;
}

const healthyServices = [
  { Service: 'postgresql', State: 'running', Health: 'healthy' },
  { Service: 'mongodb', State: 'running', Health: 'healthy' },
  { Service: 'redis', State: 'running', Health: 'healthy' },
  { Service: 'minio', State: 'running', Health: 'healthy' },
  { Service: 'keycloak', State: 'running', Health: 'healthy' },
] as const;

function dockerInspectContainer(options: {
  id: string;
  name: string;
  project: string;
  service: string;
  image?: string;
  ports: Record<string, string>;
  hostIp?: string;
}): Record<string, unknown> {
  return {
    Id: options.id,
    Name: `/${options.name}`,
    Config: {
      Image: options.image ?? `${options.service}:test`,
      Labels: {
        'com.docker.compose.project': options.project,
        'com.docker.compose.service': options.service,
      },
    },
    State: {
      Status: 'running',
      Running: true,
    },
    NetworkSettings: {
      Ports: Object.fromEntries(
        Object.entries(options.ports).map(([containerPort, hostPort]) => [
          `${containerPort}/tcp`,
          options.hostIp
            ? [{ HostIp: options.hostIp, HostPort: hostPort }]
            : [
              { HostIp: '0.0.0.0', HostPort: hostPort },
              { HostIp: '::', HostPort: hostPort },
            ],
        ]),
      ),
    },
  };
}

const healthyRuntimeContainers = [
  dockerInspectContainer({
    id: 'postgresql',
    name: 'agentsmith-unified-substrate-postgresql-1',
    project: 'agentsmith-unified-substrate',
    service: 'postgresql',
    ports: { '5432': '15432' },
  }),
  dockerInspectContainer({
    id: 'mongodb',
    name: 'agentsmith-unified-substrate-mongodb-1',
    project: 'agentsmith-unified-substrate',
    service: 'mongodb',
    ports: { '27017': '27027' },
  }),
  dockerInspectContainer({
    id: 'redis',
    name: 'agentsmith-unified-substrate-redis-1',
    project: 'agentsmith-unified-substrate',
    service: 'redis',
    ports: { '6379': '16379' },
  }),
  dockerInspectContainer({
    id: 'minio',
    name: 'agentsmith-unified-substrate-minio-1',
    project: 'agentsmith-unified-substrate',
    service: 'minio',
    ports: { '9000': '19000' },
  }),
  dockerInspectContainer({
    id: 'keycloak',
    name: 'agentsmith-unified-substrate-keycloak-1',
    project: 'agentsmith-unified-substrate',
    service: 'keycloak',
    ports: { '8080': '18080' },
  }),
];

const localKindEnv = {
  SUBSTRATE_LOCAL_KIND_HOST: '172.18.0.1',
  SUBSTRATE_POSTGRES_PASSWORD: 'pg_secret',
  SUBSTRATE_MONGODB_PASSWORD: 'mongo_secret',
  SUBSTRATE_REDIS_PASSWORD: 'redis_secret',
  SUBSTRATE_MINIO_SECRET_KEY: 'minio_secret',
  SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'keycloak_admin_secret',
} as const;

function fakeRunner(
  calls: SubstrateCommandInvocation[],
  services: readonly Record<string, string>[] = healthyServices,
  runtimeContainers: readonly Record<string, unknown>[] = healthyRuntimeContainers,
): (invocation: SubstrateCommandInvocation) => Promise<SubstrateCommandResult> {
  return async (invocation) => {
    calls.push(invocation);
    if (invocation.args.join(' ') === 'ps -q') {
      return {
        exitCode: 0,
        stdout: runtimeContainers.map((container) => String(container.Id ?? '')).filter(Boolean).join('\n'),
        stderr: '',
      };
    }
    if (invocation.args[0] === 'inspect') {
      return {
        exitCode: 0,
        stdout: JSON.stringify(runtimeContainers),
        stderr: '',
      };
    }
    if (invocation.args.includes('compose') && invocation.args.includes('ps')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify(services),
        stderr: '',
      };
    }

    return { exitCode: 0, stdout: '', stderr: '' };
  };
}

function joinedCalls(calls: readonly SubstrateCommandInvocation[]): string {
  return calls.map((call) => `${call.executable} ${call.args.join(' ')}`).join('\n');
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('unified deploy Docker substrate lifecycle producer', () => {
  it('merges Docker substrate internal service names into compose NO_PROXY while preserving host NO_PROXY', () => {
    const noProxy = buildSubstrateInternalNoProxy({
      NO_PROXY: 'corp.internal, minio',
      no_proxy: 'redis,example.test',
    });

    for (const host of DEFAULT_SUBSTRATE_INTERNAL_NO_PROXY_HOSTS) {
      expect(noProxy.split(',')).toContain(host);
    }
    expect(noProxy.split(',')).toContain('corp.internal');
    expect(noProxy.split(',')).toContain('example.test');
    expect(noProxy.split(',').filter((item) => item === 'minio')).toHaveLength(1);
    expect(noProxy.split(',').filter((item) => item === 'redis')).toHaveLength(1);
  });

  it('generates a valid ignored connection truth file by default without app or proxy keys', async () => {
    const tempRoot = makeTempRoot();
    const truthPath = join(tempRoot, 'connection.env');
    const calls: SubstrateCommandInvocation[] = [];

    const evidence = await runSubstrateLifecycle({
      command: 'status',
      profile: 'local-kind',
      truthPath,
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls),
      env: {
        ...localKindEnv,
        SUBSTRATE_POSTGRES_PASSWORD: 'pg_secret_for_lifecycle_test',
        SUBSTRATE_MONGODB_PASSWORD: 'mongo_secret_for_lifecycle_test',
        SUBSTRATE_REDIS_PASSWORD: 'redis_secret_for_lifecycle_test',
        SUBSTRATE_MINIO_SECRET_KEY: 'minio_secret_for_lifecycle_test',
        SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'keycloak_admin_secret_for_lifecycle_test',
      },
    });

    const truthText = readFileSync(truthPath, 'utf8');
    const validation = validateSubstrateTruthText(truthText, { sourcePath: truthPath });

    expect(DEFAULT_SUBSTRATE_TRUTH_OUTPUT_PATH.endsWith('infra/deploy/unified/substrate/connection.env')).toBe(true);
    expect(validation.ok).toBe(true);
    expect(truthText).toContain(`SUBSTRATE_TRUTH_SCHEMA_VERSION=${SUBSTRATE_TRUTH_SCHEMA_VERSION}`);
    expect(truthText).not.toMatch(/LLMUP|UNIVERSAL_PROXY|API_BASE|NEXT_PUBLIC|WEB_/u);
    expect(evidence.truth.redacted_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it.each(['up', 'status'] as const)('targets only Docker substrate services for %s', async (command) => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];

    await runSubstrateLifecycle({
      command,
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls),
      env: localKindEnv,
    });

    const text = joinedCalls(calls);
    expect(text).toContain('postgresql');
    expect(text).toContain('mongodb');
    expect(text).toContain('redis');
    expect(text).toContain('minio');
    expect(text).toContain('keycloak');
    expect(text).not.toMatch(/\b(api|web|llmup|universal-proxy|execution-gateway)\b/u);
  });

  it('keeps reset destructive only for the Docker substrate compose project', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];

    await runSubstrateLifecycle({
      command: 'reset',
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls),
      env: localKindEnv,
    });

    const text = joinedCalls(calls);
    const exactArgs = calls.flatMap((call) => call.args);
    expect(text).toContain(' down -v');
    expect(text).toMatch(/\bup\b[\s\S]*\bpostgresql\b[\s\S]*\bkeycloak\b/u);
    expect(exactArgs).not.toEqual(expect.arrayContaining(['api', 'web', 'llmup', 'universal-proxy', 'execution-gateway']));
  });

  it('limits reseed to dependency readiness and never product bootstrap', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];

    await runSubstrateLifecycle({
      command: 'reseed',
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls),
      env: localKindEnv,
    });

    const text = joinedCalls(calls);
    expect(text).toContain('minio-init');
    expect(text).toContain('kcadm.sh');
    expect(text).toContain('psql');
    expect(text).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    expect(text).not.toMatch(/ensure-default-workspace|workspace|project|endpoint|agent-runner|runner|\/api\/v1/u);
  });

  it('fails reseed with timeout evidence instead of waiting forever on a stuck init helper', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];
    const runner = async (invocation: SubstrateCommandInvocation): Promise<SubstrateCommandResult> => {
      calls.push(invocation);
      if (invocation.args.join(' ') === 'ps -q') {
        return {
          exitCode: 0,
          stdout: healthyRuntimeContainers.map((container) => String(container.Id ?? '')).filter(Boolean).join('\n'),
          stderr: '',
        };
      }
      if (invocation.args[0] === 'inspect') {
        return {
          exitCode: 0,
          stdout: JSON.stringify(healthyRuntimeContainers),
          stderr: '',
        };
      }
      if (invocation.args.includes('compose') && invocation.args.includes('ps')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(healthyServices),
          stderr: '',
        };
      }
      if (invocation.args.includes('run') && invocation.args.includes('minio-init')) {
        return {
          exitCode: 124,
          stdout: '',
          stderr: `command timed out after ${invocation.timeoutMs ?? 0}ms`,
        };
      }

      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const evidence = await runSubstrateLifecycle({
      command: 'reseed',
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner,
      env: {
        ...localKindEnv,
        SUBSTRATE_RESEED_STEP_TIMEOUT_MS: '1000',
      },
    });
    const minioStep = evidence.steps.find((step) => step.name === 'minio-bucket-readiness');
    const minioCall = calls.find((call) => call.args.includes('run') && call.args.includes('minio-init'));

    expect(evidence.status).toBe('failed');
    expect(minioStep).toEqual(expect.objectContaining({
      status: 'failed',
      exit_code: 124,
      timeout_ms: 1000,
    }));
    expect(minioCall?.timeoutMs).toBe(1000);
    expect(evidence.failures.map((failure) => failure.message).join('\n')).toContain('timed out');
  });

  it('fails closed when status does not report every required service healthy', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];
    const evidence = await runSubstrateLifecycle({
      command: 'status',
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls, [
        { Service: 'postgresql', State: 'running', Health: 'healthy' },
        { Service: 'mongodb', State: 'running', Health: 'starting' },
        { Service: 'redis', State: 'exited', Health: 'unhealthy' },
      ]),
      env: localKindEnv,
    });

    const failureText = evidence.failures.map((failure) => failure.message).join('\n');

    expect(evidence.status).toBe('failed');
    expect(failureText).toContain('missing healthy Docker substrate services');
    expect(failureText).toContain('mongodb is running/starting');
    expect(failureText).toContain('redis is exited/unhealthy');
    expect(failureText).toContain('minio is missing');
    expect(failureText).toContain('keycloak is missing');
  });

  it('fails status when healthy compose services publish host ports that do not match connection truth', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];
    const evidence = await runSubstrateLifecycle({
      command: 'status',
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls, healthyServices, healthyRuntimeContainers.map((container) =>
        container.Id === 'mongodb'
          ? dockerInspectContainer({
            id: 'mongodb',
            name: 'agentsmith-unified-substrate-mongodb-1',
            project: 'agentsmith-unified-substrate',
            service: 'mongodb',
            ports: { '27017': '17017' },
          })
          : container,
      )),
      env: localKindEnv,
    });
    const failureText = evidence.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n');

    expect(evidence.status).toBe('failed');
    expect(evidence.runtime_truth.status).toBe('failed');
    expect(failureText).toContain('substrate-runtime:mongodb');
    expect(failureText).toContain('agentsmith-unified-substrate/mongodb');
    expect(failureText).toContain('27027');
    expect(failureText).toContain('17017');
  });

  it('fails status when a truth-matching host port is only bound to loopback', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];
    const evidence = await runSubstrateLifecycle({
      command: 'status',
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls, healthyServices, healthyRuntimeContainers.map((container) =>
        container.Id === 'mongodb'
          ? dockerInspectContainer({
            id: 'mongodb',
            name: 'agentsmith-unified-substrate-mongodb-1',
            project: 'agentsmith-unified-substrate',
            service: 'mongodb',
            ports: { '27017': '27027' },
            hostIp: '127.0.0.1',
          })
          : container,
      )),
      env: localKindEnv,
    });
    const failureText = evidence.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n');

    expect(evidence.status).toBe('failed');
    expect(evidence.runtime_truth.status).toBe('failed');
    expect(failureText).toContain('substrate-runtime:mongodb');
    expect(failureText).toContain('127.0.0.1:27027');
    expect(failureText).toContain('not routable');
    expect(evidence.runtime_truth.checks.find((check) => check.service === 'mongodb')?.actual_owner?.host_bindings).toEqual([
      { host_ip: '127.0.0.1', host_port: '27027' },
    ]);
  });

  it('fails status with owner details when only a legacy non-owned Mongo substrate container is running', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];
    const evidence = await runSubstrateLifecycle({
      command: 'status',
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls, [], [
        dockerInspectContainer({
          id: 'legacy-mongodb',
          name: 'mbos-mongo',
          project: 'mbos-integration-deps',
          service: 'mongo',
          image: 'mongo:7',
          ports: { '27017': '17017' },
        }),
      ]),
      env: localKindEnv,
    });
    const failureText = evidence.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n');

    expect(evidence.status).toBe('failed');
    expect(evidence.runtime_truth.status).toBe('failed');
    expect(failureText).toContain('mbos-integration-deps/mongo');
    expect(failureText).toContain('mbos-mongo');
    expect(failureText).toContain('17017');
    expect(failureText).toContain('agentsmith-unified-substrate/mongodb');
  });

  it('waits for healthy services after up before passing evidence', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];
    const psResponses = [
      [
        { Service: 'postgresql', State: 'running', Health: 'starting' },
        { Service: 'mongodb', State: 'running', Health: 'starting' },
        { Service: 'redis', State: 'running', Health: 'starting' },
        { Service: 'minio', State: 'running', Health: 'starting' },
        { Service: 'keycloak', State: 'running', Health: 'starting' },
      ],
      healthyServices,
    ];
    const runner = async (invocation: SubstrateCommandInvocation): Promise<SubstrateCommandResult> => {
      calls.push(invocation);
      if (invocation.args.join(' ') === 'ps -q') {
        return {
          exitCode: 0,
          stdout: healthyRuntimeContainers.map((container) => String(container.Id ?? '')).filter(Boolean).join('\n'),
          stderr: '',
        };
      }
      if (invocation.args[0] === 'inspect') {
        return {
          exitCode: 0,
          stdout: JSON.stringify(healthyRuntimeContainers),
          stderr: '',
        };
      }
      if (invocation.args.includes('compose') && invocation.args.includes('ps')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(psResponses.shift() ?? healthyServices),
          stderr: '',
        };
      }

      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const evidence = await runSubstrateLifecycle({
      command: 'up',
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner,
      env: {
        ...localKindEnv,
        SUBSTRATE_HEALTH_POLL_INTERVAL_MS: '1',
      },
    });

    expect(evidence.status).toBe('passed');
    expect(calls.filter((call) => call.args.includes('compose') && call.args.includes('ps'))).toHaveLength(2);
  });

  it('fails up when required services never become healthy', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];
    const evidence = await runSubstrateLifecycle({
      command: 'up',
      profile: 'local-kind',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls, []),
      env: {
        ...localKindEnv,
        SUBSTRATE_HEALTH_ATTEMPTS: '1',
        SUBSTRATE_HEALTH_POLL_INTERVAL_MS: '1',
      },
    });

    expect(evidence.status).toBe('failed');
    expect(evidence.failures.map((failure) => failure.message).join('\n')).toContain('missing healthy Docker substrate services');
  });

  it('writes redacted lifecycle evidence without leaking truth secrets', async () => {
    const tempRoot = makeTempRoot();
    const calls: SubstrateCommandInvocation[] = [];

    const evidence = await runSubstrateLifecycle({
      command: 'up',
      profile: 'existing-cluster',
      truthPath: join(tempRoot, 'connection.env'),
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls),
      env: {
        SUBSTRATE_HOST: '10.0.0.10',
        SUBSTRATE_POSTGRES_PASSWORD: 'pg_secret_redaction_probe',
        SUBSTRATE_MONGODB_PASSWORD: 'mongo_secret_redaction_probe',
        SUBSTRATE_REDIS_PASSWORD: 'redis_secret_redaction_probe',
        SUBSTRATE_MINIO_SECRET_KEY: 'minio_secret_redaction_probe',
        SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'keycloak_admin_secret_redaction_probe',
      },
    });

    const evidenceText = readFileSync(evidence.paths.report_path, 'utf8');

    expect(evidence.schema_version).toBe('agentsmith.unified-deploy.substrate-lifecycle.evidence/v1');
    expect(evidence.command).toBe('up' satisfies SubstrateLifecycleCommand);
    expect(evidence.profile).toBe('existing-cluster');
    expect(evidence.compose_project).toBe('agentsmith-unified-substrate');
    expect(evidence.services).toEqual(['postgresql', 'mongodb', 'redis', 'minio', 'keycloak']);
    expect(evidence.status).toBe('passed');
    expect(evidenceText).not.toContain('pg_secret_redaction_probe');
    expect(evidenceText).not.toContain('mongo_secret_redaction_probe');
    expect(evidenceText).not.toContain('redis_secret_redaction_probe');
    expect(evidenceText).not.toContain('minio_secret_redaction_probe');
    expect(evidenceText).not.toContain('keycloak_admin_secret_redaction_probe');
  });

  it('builds stable truth text from explicit operator env overrides', () => {
    const truthText = buildSubstrateTruthText({
      profile: 'existing-cluster',
      env: {
        SUBSTRATE_POSTGRES_HOST: '10.0.0.10',
        SUBSTRATE_MONGODB_HOST: '10.0.0.11',
        SUBSTRATE_REDIS_HOST: '10.0.0.12',
        SUBSTRATE_MINIO_HOST: '10.0.0.13',
        SUBSTRATE_KEYCLOAK_HOST: '10.0.0.14',
        SUBSTRATE_POSTGRES_PORT: '25432',
        SUBSTRATE_POSTGRES_PASSWORD: 'pg_secret',
        SUBSTRATE_MONGODB_PASSWORD: 'mongo_secret',
        SUBSTRATE_REDIS_PASSWORD: 'redis_secret',
        SUBSTRATE_MINIO_SECRET_KEY: 'minio_secret',
        SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'keycloak_admin_secret',
        SUBSTRATE_KEYCLOAK_PORT: '28080',
      },
    });
    const validation = validateSubstrateTruthText(truthText, { sourcePath: 'generated.env' });

    expect(validation.ok).toBe(true);
    expect(truthText).toContain('SUBSTRATE_POSTGRES_HOST=10.0.0.10');
    expect(truthText).toContain('SUBSTRATE_MONGODB_HOST=10.0.0.11');
    expect(truthText).toContain('SUBSTRATE_REDIS_HOST=10.0.0.12');
    expect(truthText).toContain('SUBSTRATE_MINIO_HOST=10.0.0.13');
    expect(truthText).toContain('SUBSTRATE_KEYCLOAK_HOST=10.0.0.14');
    expect(truthText).toContain('SUBSTRATE_POSTGRES_PORT=25432');
    expect(truthText).toContain('SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL=http://substrate-keycloak:8080');
  });

  it('fails closed for existing-cluster when explicit secrets are present but hosts are omitted', async () => {
    const tempRoot = makeTempRoot();
    const truthPath = join(tempRoot, 'connection.env');
    const calls: SubstrateCommandInvocation[] = [];
    const evidence = await runSubstrateLifecycle({
      command: 'status',
      profile: 'existing-cluster',
      truthPath,
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls),
      env: {
        SUBSTRATE_POSTGRES_PASSWORD: 'pg_secret',
        SUBSTRATE_MONGODB_PASSWORD: 'mongo_secret',
        SUBSTRATE_REDIS_PASSWORD: 'redis_secret',
        SUBSTRATE_MINIO_SECRET_KEY: 'minio_secret',
        SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'keycloak_admin_secret',
      },
    });

    expect(evidence.status).toBe('failed');
    expect(() => readFileSync(truthPath, 'utf8')).toThrow();
    expect(readFileSync(evidence.paths.report_path, 'utf8')).not.toContain('host.docker.internal');
    expect(evidence.failures.map((failure) => failure.message).join('\n')).toContain(
      'existing-cluster substrate truth requires explicit non-local host values',
    );
  });

  it('allows a non-local shared existing-cluster substrate host for all dependency hosts', () => {
    const truthText = buildSubstrateTruthText({
      profile: 'existing-cluster',
      env: {
        SUBSTRATE_HOST: '10.42.0.10',
        SUBSTRATE_POSTGRES_PASSWORD: 'pg_secret',
        SUBSTRATE_MONGODB_PASSWORD: 'mongo_secret',
        SUBSTRATE_REDIS_PASSWORD: 'redis_secret',
        SUBSTRATE_MINIO_SECRET_KEY: 'minio_secret',
        SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'keycloak_admin_secret',
      },
    });

    expect(validateSubstrateTruthText(truthText, { sourcePath: 'existing-cluster.env' }).ok).toBe(true);
    for (const key of [
      'SUBSTRATE_POSTGRES_HOST',
      'SUBSTRATE_MONGODB_HOST',
      'SUBSTRATE_REDIS_HOST',
      'SUBSTRATE_MINIO_HOST',
      'SUBSTRATE_KEYCLOAK_HOST',
    ]) {
      expect(truthText).toContain(`${key}=10.42.0.10`);
    }
  });

  it('rejects local-only existing-cluster substrate hosts even when explicitly provided', () => {
    expect(() => buildSubstrateTruthText({
      profile: 'existing-cluster',
      env: {
        SUBSTRATE_HOST: 'host.docker.internal',
        SUBSTRATE_POSTGRES_PASSWORD: 'pg_secret',
        SUBSTRATE_MONGODB_PASSWORD: 'mongo_secret',
        SUBSTRATE_REDIS_PASSWORD: 'redis_secret',
        SUBSTRATE_MINIO_SECRET_KEY: 'minio_secret',
        SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'keycloak_admin_secret',
      },
    })).toThrow(/explicit non-local host values/u);
  });

  it('fails closed for existing-cluster when explicit substrate secrets are missing', async () => {
    const tempRoot = makeTempRoot();
    const truthPath = join(tempRoot, 'connection.env');
    const calls: SubstrateCommandInvocation[] = [];
    const evidence = await runSubstrateLifecycle({
      command: 'status',
      profile: 'existing-cluster',
      truthPath,
      evidenceDir: join(tempRoot, 'evidence'),
      runner: fakeRunner(calls),
      env: {
        SUBSTRATE_POSTGRES_HOST: '10.0.0.10',
        SUBSTRATE_MONGODB_HOST: '10.0.0.10',
        SUBSTRATE_REDIS_HOST: '10.0.0.10',
        SUBSTRATE_MINIO_HOST: '10.0.0.10',
        SUBSTRATE_KEYCLOAK_HOST: '10.0.0.10',
      },
    });

    expect(evidence.status).toBe('failed');
    expect(readFileSync(evidence.paths.report_path, 'utf8')).not.toContain('agentsmith_dev_password');
    expect(() => readFileSync(truthPath, 'utf8')).toThrow();
    expect(evidence.failures.map((failure) => failure.message).join('\n')).toContain(
      'existing-cluster substrate truth requires explicit values',
    );
  });

  it('fails fast instead of generating misleading local-kind host truth without a pod-routable host', () => {
    expect(() => buildSubstrateTruthText({
      profile: 'local-kind',
      env: {
        SUBSTRATE_POSTGRES_PASSWORD: 'pg_secret',
        SUBSTRATE_MONGODB_PASSWORD: 'mongo_secret',
        SUBSTRATE_REDIS_PASSWORD: 'redis_secret',
        SUBSTRATE_MINIO_SECRET_KEY: 'minio_secret',
        SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'keycloak_admin_secret',
      },
      detectLocalKindHost: () => null,
    })).toThrow(/SUBSTRATE_LOCAL_KIND_HOST/u);
  });

  it('uses a pod-routable local-kind host for every generated substrate address', () => {
    const truthText = buildSubstrateTruthText({
      profile: 'local-kind',
      env: {
        SUBSTRATE_POSTGRES_PASSWORD: 'pg_secret',
        SUBSTRATE_MONGODB_PASSWORD: 'mongo_secret',
        SUBSTRATE_REDIS_PASSWORD: 'redis_secret',
        SUBSTRATE_MINIO_SECRET_KEY: 'minio_secret',
        SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'keycloak_admin_secret',
      },
      detectLocalKindHost: () => '172.18.0.1',
    });

    expect(validateSubstrateTruthText(truthText, { sourcePath: 'local-kind.env' }).ok).toBe(true);
    expect(truthText).toContain('SUBSTRATE_POSTGRES_HOST=172.18.0.1');
    expect(truthText).not.toContain('host.docker.internal');
  });
});
