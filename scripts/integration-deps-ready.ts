import { execFile } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleepMs } from 'node:timers/promises';
import { promisify } from 'node:util';

export const INTEGRATION_DEPS_PROBES = [
  'postgres',
  'mongo',
  'redis',
  'minio',
  'keycloak',
] as const;

const execFileAsync = promisify(execFile);

export type IntegrationDepsProbeName = (typeof INTEGRATION_DEPS_PROBES)[number];

export type IntegrationDepsReadyResult = {
  ok: boolean;
  attempts: number;
  elapsedMs: number;
  pending: readonly IntegrationDepsProbeName[];
};

export type IntegrationDepsProbeContext = {
  deadlineMs: number;
  remainingMs: number;
};

export interface IntegrationDepsReadyOptions {
  timeoutMs: number;
  pollMs: number;
  probe: (name: IntegrationDepsProbeName, context: IntegrationDepsProbeContext) => Promise<boolean>;
  sleep: (delayMs: number) => Promise<void>;
  now: () => number;
}

type IntegrationDepsConfig = {
  postgresPort: number;
  mongoPort: number;
  redisPort: number;
  redisPassword: string;
  minioPort: number;
  keycloakBaseUrl: string;
  probeTimeoutMs: number;
};

type DockerHealthProbeResult = boolean | null;

type DefaultIntegrationDepsProbePrimitives = {
  dockerHealthProbe: (name: IntegrationDepsProbeName, timeoutMs: number) => Promise<DockerHealthProbeResult>;
  tcpProbe: (port: number, timeoutMs: number) => Promise<boolean>;
  redisAuthProbe: (port: number, password: string, timeoutMs: number) => Promise<boolean>;
  httpProbe: (url: string, timeoutMs: number) => Promise<boolean>;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function validateLocalRedisPassword(value: string): string {
  if (!/^[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new Error('local Redis password must be URL-safe/simple ([A-Za-z0-9_.-]+)');
  }
  return value;
}

function defaultConfig(env: NodeJS.ProcessEnv = process.env): IntegrationDepsConfig {
  return {
    postgresPort: parsePositiveInteger(env.POSTGRES_PORT, 15432),
    mongoPort: parsePositiveInteger(env.MONGO_PORT, 17017),
    redisPort: parsePositiveInteger(env.REDIS_PORT, 16379),
    redisPassword: validateLocalRedisPassword(env.REDIS_PASSWORD ?? 'mbos_dev_password'),
    minioPort: parsePositiveInteger(env.MINIO_API_PORT ?? env.MINIO_PORT, 19000),
    keycloakBaseUrl: env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080',
    probeTimeoutMs: parsePositiveInteger(env.DEPS_READY_PROBE_TIMEOUT_MS, 1500),
  };
}

function tcpProbe(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolveProbe(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function httpOkProbe(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function encodeRedisCommand(parts: readonly string[]): Buffer {
  const chunks: Buffer[] = [Buffer.from(`*${parts.length}\r\n`)];
  for (const part of parts) {
    const data = Buffer.from(part);
    chunks.push(Buffer.from(`$${data.length}\r\n`), data, Buffer.from('\r\n'));
  }
  return Buffer.concat(chunks);
}

function readRedisLine(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve) => {
    let data = Buffer.alloc(0);
    const finish = (chunk?: Buffer): void => {
      if (chunk) {
        data = Buffer.concat([data, chunk]);
      }
      resolve(data);
    };
    socket.once('data', finish);
    socket.once('timeout', () => finish());
    socket.once('error', () => finish());
  });
}

async function redisAuthProbe(port: number, password: string, timeoutMs: number): Promise<boolean> {
  validateLocalRedisPassword(password);
  return await new Promise((resolveProbe) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolveProbe(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      void (async () => {
        socket.write(encodeRedisCommand(['AUTH', password]));
        const authReply = await readRedisLine(socket);
        if (!authReply.toString('utf8').startsWith('+OK')) {
          finish(false);
          return;
        }
        socket.write(encodeRedisCommand(['PING']));
        const pingReply = await readRedisLine(socket);
        finish(pingReply.toString('utf8').startsWith('+PONG'));
      })().catch(() => finish(false));
    });
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function containerNameForProbe(name: IntegrationDepsProbeName): string {
  if (name === 'postgres') {
    return 'mbos-postgres';
  }
  if (name === 'mongo') {
    return 'mbos-mongo';
  }
  if (name === 'redis') {
    return 'mbos-redis';
  }
  if (name === 'minio') {
    return 'mbos-minio';
  }
  return 'mbos-keycloak';
}

async function dockerHealthProbe(
  name: IntegrationDepsProbeName,
  timeoutMs: number,
): Promise<DockerHealthProbeResult> {
  let stdout: string;
  try {
    const result = await execFileAsync('docker', [
      'inspect',
      '--format',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-health{{end}}',
      containerNameForProbe(name),
    ], {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    stdout = String(result.stdout);
  } catch {
    return null;
  }
  const status = stdout.trim();
  if (status === 'healthy') {
    return true;
  }
  if (status === 'starting' || status === 'unhealthy') {
    return false;
  }
  return null;
}

function probeTimeout(config: IntegrationDepsConfig, context: IntegrationDepsProbeContext): number {
  return Math.max(1, Math.min(config.probeTimeoutMs, context.remainingMs));
}

export function createDefaultIntegrationDepsProbe(
  config: IntegrationDepsConfig = defaultConfig(),
  primitives: DefaultIntegrationDepsProbePrimitives = {
    dockerHealthProbe,
    tcpProbe,
    redisAuthProbe,
    httpProbe: httpOkProbe,
  },
): (name: IntegrationDepsProbeName, context: IntegrationDepsProbeContext) => Promise<boolean> {
  return async (name, context) => {
    const timeoutMs = probeTimeout(config, context);
    if (name === 'postgres') {
      return await primitives.dockerHealthProbe(name, timeoutMs)
        ?? primitives.tcpProbe(config.postgresPort, timeoutMs);
    }
    if (name === 'mongo') {
      return await primitives.dockerHealthProbe(name, timeoutMs)
        ?? primitives.tcpProbe(config.mongoPort, timeoutMs);
    }
    if (name === 'redis') {
      const health = await primitives.dockerHealthProbe(name, timeoutMs);
      if (health === false) {
        return false;
      }
      return primitives.redisAuthProbe(config.redisPort, config.redisPassword, timeoutMs);
    }
    if (name === 'minio') {
      return await primitives.dockerHealthProbe(name, timeoutMs)
        ?? primitives.httpProbe(`http://127.0.0.1:${config.minioPort}/minio/health/live`, timeoutMs);
    }
    return primitives.httpProbe(
      `${config.keycloakBaseUrl.replace(/\/$/u, '')}/realms/mbos/.well-known/openid-configuration`,
      timeoutMs,
    );
  };
}

export async function waitForIntegrationDepsReady(
  options: IntegrationDepsReadyOptions,
): Promise<IntegrationDepsReadyResult> {
  const start = options.now();
  const deadlineMs = start + options.timeoutMs;
  let attempts = 0;
  let pending: IntegrationDepsProbeName[] = [...INTEGRATION_DEPS_PROBES];

  while (true) {
    const remainingMs = deadlineMs - options.now();
    if (remainingMs <= 0) {
      return {
        ok: false,
        attempts,
        elapsedMs: options.now() - start,
        pending,
      };
    }
    attempts += 1;
    const probeContext: IntegrationDepsProbeContext = {
      deadlineMs,
      remainingMs,
    };
    const probeResults = await Promise.all(INTEGRATION_DEPS_PROBES.map(async (name) => ({
      name,
      ok: await options.probe(name, probeContext),
    })));
    const currentPending = probeResults
      .filter((result) => !result.ok)
      .map((result) => result.name);
    pending = currentPending;
    const elapsedMs = options.now() - start;
    if (pending.length === 0) {
      return {
        ok: true,
        attempts,
        elapsedMs,
        pending,
      };
    }
    if (elapsedMs >= options.timeoutMs) {
      return {
        ok: false,
        attempts,
        elapsedMs,
        pending,
      };
    }
    await options.sleep(Math.min(options.pollMs, options.timeoutMs - elapsedMs));
  }
}

async function main(): Promise<number> {
  const timeoutMs = parsePositiveInteger(process.env.DEPS_READY_TIMEOUT_MS, 120_000);
  const pollMs = parsePositiveInteger(process.env.DEPS_READY_POLL_MS, 1_000);
  process.stdout.write(`[integration-deps-ready] polling dependencies for up to ${timeoutMs}ms\n`);
  const result = await waitForIntegrationDepsReady({
    timeoutMs,
    pollMs,
    now: () => Date.now(),
    sleep: (delayMs) => sleepMs(delayMs).then(() => undefined),
    probe: createDefaultIntegrationDepsProbe(),
  });
  if (result.ok) {
    process.stdout.write(`[integration-deps-ready] ready after ${result.elapsedMs}ms (${result.attempts} attempt(s))\n`);
    return 0;
  }
  process.stderr.write(
    `[integration-deps-ready] timed out after ${result.elapsedMs}ms; pending: ${result.pending.join(', ')}\n`,
  );
  return 1;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/integration-deps-ready.ts')) {
  void main().then((exitCode) => {
    process.exit(exitCode);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[integration-deps-ready] ${message}\n`);
    process.exit(1);
  });
}
