import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  createDefaultIntegrationDepsProbe,
  validateLocalRedisPassword,
  waitForIntegrationDepsReady,
  type IntegrationDepsProbeName,
} from './integration-deps-ready';

function readMakeTargetBlock(makefile: string, target: string): string {
  return makefile.match(new RegExp(`^${target}:[^\\n]*(?:\\n\\t[^\\n]*)*`, 'm'))?.[0] ?? '';
}

describe('integration deps readiness polling', () => {
  it('continues immediately when all dependencies are healthy', async () => {
    const probes: IntegrationDepsProbeName[] = [];
    const sleeps: number[] = [];

    const result = await waitForIntegrationDepsReady({
      timeoutMs: 25_000,
      pollMs: 500,
      now: () => 1_000,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
      },
      probe: async (name) => {
        probes.push(name);
        return true;
      },
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.pending).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(probes).toEqual(['postgres', 'mongo', 'redis', 'minio', 'keycloak']);
  });

  it('runs dependency probes in parallel within each polling attempt', async () => {
    const probes: IntegrationDepsProbeName[] = [];
    let activeProbeCount = 0;
    let maxActiveProbeCount = 0;

    const result = await waitForIntegrationDepsReady({
      timeoutMs: 25_000,
      pollMs: 500,
      now: () => 1_000,
      sleep: async () => {
        throw new Error('healthy parallel probes should not sleep');
      },
      probe: async (name) => {
        probes.push(name);
        activeProbeCount += 1;
        maxActiveProbeCount = Math.max(maxActiveProbeCount, activeProbeCount);
        await Promise.resolve();
        activeProbeCount -= 1;
        return true;
      },
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(maxActiveProbeCount).toBe(5);
    expect(probes).toEqual(['postgres', 'mongo', 'redis', 'minio', 'keycloak']);
  });

  it('polls only until health is reached and does not use a fixed 25 second sleep', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const attemptsByProbe = new Map<IntegrationDepsProbeName, number>();

    const result = await waitForIntegrationDepsReady({
      timeoutMs: 10_000,
      pollMs: 250,
      now: () => clock,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
        clock += delayMs;
      },
      probe: async (name) => {
        attemptsByProbe.set(name, (attemptsByProbe.get(name) ?? 0) + 1);
        return name === 'keycloak'
          ? (attemptsByProbe.get(name) ?? 0) >= 3
          : true;
      },
    });

    expect(result).toMatchObject({
      ok: true,
      attempts: 3,
      elapsedMs: 500,
      pending: [],
    });
    expect(sleeps).toEqual([250, 250]);
    expect(sleeps).not.toContain(25_000);
  });

  it('fails with bounded timeout and reports pending dependencies', async () => {
    let clock = 0;

    const result = await waitForIntegrationDepsReady({
      timeoutMs: 750,
      pollMs: 250,
      now: () => clock,
      sleep: async (delayMs) => {
        clock += delayMs;
      },
      probe: async (name) => name !== 'keycloak',
    });

    expect(result.ok).toBe(false);
    expect(result.pending).toEqual(['keycloak']);
    expect(result.elapsedMs).toBe(750);
  });

  it('passes the shared global deadline into each probe instead of accumulating per-service timeouts', async () => {
    let clock = 100;
    const remainingByAttempt: number[][] = [];
    let attemptIndex = -1;

    const result = await waitForIntegrationDepsReady({
      timeoutMs: 750,
      pollMs: 250,
      now: () => clock,
      sleep: async (delayMs) => {
        clock += delayMs;
      },
      probe: async (_name, context) => {
        if (remainingByAttempt[attemptIndex]?.length === 5) {
          attemptIndex += 1;
        }
        if (attemptIndex < 0) {
          attemptIndex = 0;
        }
        remainingByAttempt[attemptIndex] ??= [];
        remainingByAttempt[attemptIndex].push(context.remainingMs);
        return false;
      },
    });

    expect(result.ok).toBe(false);
    expect(result.elapsedMs).toBe(750);
    expect(remainingByAttempt[0]).toEqual([750, 750, 750, 750, 750]);
    expect(remainingByAttempt.at(-1)?.every((remainingMs) => remainingMs <= 750)).toBe(true);
  });

  it('uses Docker health status before falling back to plain TCP for compose-health services', async () => {
    const calls: string[] = [];
    const probe = createDefaultIntegrationDepsProbe({
      postgresPort: 15432,
      mongoPort: 17017,
      redisPort: 16379,
      redisPassword: 'mbos_dev_password',
      minioPort: 19000,
      keycloakBaseUrl: 'http://localhost:18080',
      probeTimeoutMs: 1500,
    }, {
      dockerHealthProbe: async (name) => {
        calls.push(`health:${name}`);
        return name === 'postgres' ? true : null;
      },
      tcpProbe: async (port) => {
        calls.push(`tcp:${port}`);
        return true;
      },
      redisAuthProbe: async (port) => {
        calls.push(`redis-auth:${port}`);
        return true;
      },
      httpProbe: async (url) => {
        calls.push(`http:${url}`);
        return true;
      },
    });

    await expect(probe('postgres', {
      deadlineMs: 1_000,
      remainingMs: 1_000,
    })).resolves.toBe(true);
    expect(calls).toEqual(['health:postgres']);
  });

  it('requires Redis auth ping even when the container healthcheck is healthy', async () => {
    const calls: string[] = [];
    const probe = createDefaultIntegrationDepsProbe({
      postgresPort: 15432,
      mongoPort: 17017,
      redisPort: 16379,
      redisPassword: 'mbos_dev_password',
      minioPort: 19000,
      keycloakBaseUrl: 'http://localhost:18080',
      probeTimeoutMs: 1500,
    }, {
      dockerHealthProbe: async (name) => {
        calls.push(`health:${name}`);
        return true;
      },
      tcpProbe: async (port) => {
        calls.push(`tcp:${port}`);
        return true;
      },
      redisAuthProbe: async (port, password) => {
        calls.push(`redis-auth:${port}:${password}`);
        return false;
      },
      httpProbe: async (url) => {
        calls.push(`http:${url}`);
        return true;
      },
    });

    await expect(probe('redis', {
      deadlineMs: 1_000,
      remainingMs: 1_000,
    })).resolves.toBe(false);
    expect(calls).toEqual(['health:redis', 'redis-auth:16379:mbos_dev_password']);
  });

  it('fails fast for local Redis passwords that are not URL-safe and simple', () => {
    expect(validateLocalRedisPassword('mbos_dev_password-1.2')).toBe('mbos_dev_password-1.2');
    expect(() => validateLocalRedisPassword('bad:value')).toThrow('local Redis password must be URL-safe/simple');
    expect(() => validateLocalRedisPassword('bad/value')).toThrow('local Redis password must be URL-safe/simple');
    expect(() => validateLocalRedisPassword('')).toThrow('local Redis password must be URL-safe/simple');
  });

  it('wires Makefile deps-ready to health polling instead of DEPS_READY_SLEEP', () => {
    const makefile = readFileSync('Makefile', 'utf8');

    expect(makefile).toContain('scripts/integration-deps-ready.ts');
    expect(makefile).not.toContain('DEPS_READY_SLEEP');
    expect(makefile).not.toContain('sleep $(DEPS_READY_SLEEP)');
  });

  it('keeps Makefile deps-ready readiness-only and names the combined helper deps-bootstrap', () => {
    const makefile = readFileSync('Makefile', 'utf8');
    const depsReady = readMakeTargetBlock(makefile, 'deps-ready');
    const depsBootstrap = readMakeTargetBlock(makefile, 'deps-bootstrap');
    const depsInit = readMakeTargetBlock(makefile, 'deps-init');
    const depsSmoke = readMakeTargetBlock(makefile, 'deps-smoke');
    const bootstrap = readMakeTargetBlock(makefile, 'bootstrap');

    expect(depsReady).not.toBe('');
    expect(depsReady.split('\n')[0]).not.toMatch(/\bdeps-up\b/);
    expect(depsReady).not.toMatch(/\bintegration:deps:up\b|\bdeps-up\b/);
    expect(depsReady).toContain('scripts/integration-deps-ready.ts');

    expect(depsBootstrap).not.toBe('');
    expect(depsBootstrap).toMatch(/\bdeps-up\b/);
    expect(depsBootstrap).toMatch(/\bdeps-ready\b/);

    expect(depsInit.split('\n')[0]).toMatch(/\bdeps-bootstrap\b/);
    expect(depsInit.split('\n')[0]).not.toMatch(/\bdeps-ready\b/);
    expect(depsSmoke.split('\n')[0]).toMatch(/\bdeps-init\b/);
    expect(bootstrap.split('\n')[0]).toMatch(/\bdeps-smoke\b/);
  });

  it('keeps minio-init internal MinIO calls out of inherited proxies', () => {
    const composeText = readFileSync('infra/integration/docker-compose.yml', 'utf8');
    const minioInitBlock = composeText.match(/\n  minio-init:\n[\s\S]*?(?=\n  [a-z][\w-]*:|\nvolumes:)/u)?.[0] ?? '';

    expect(minioInitBlock).not.toBe('');
    expect(minioInitBlock).toContain('NO_PROXY:');
    expect(minioInitBlock).toContain('no_proxy:');

    for (const host of ['minio', 'mbos-minio', '127.0.0.1', 'localhost']) {
      expect(minioInitBlock).toContain(host);
    }
  });
});
