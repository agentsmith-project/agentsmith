import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import {
  REPO_ROOT,
  asRecord,
  type CheckFailure,
  type CheckResult,
} from './manifest';
import {
  DEFAULT_SUBSTRATE_TRUTH_PATH,
  validateSubstrateTruthText,
} from './substrate-truth';
import { writeProducerEvidence } from './evidence';

export const DEFAULT_SUBSTRATE_COMPOSE_PATH = path.join(
  REPO_ROOT,
  'infra',
  'deploy',
  'unified',
  'substrate',
  'docker-compose.yml',
);
export { DEFAULT_SUBSTRATE_TRUTH_PATH };

type SubstrateBoundaryOptions = {
  composePath?: string;
  truthPath?: string;
};

const REQUIRED_SUBSTRATE_SERVICES = ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'] as const;
const REQUIRED_SUBSTRATE_SERVICE_SET = new Set<string>(REQUIRED_SUBSTRATE_SERVICES);
const FORBIDDEN_DOCKER_SUBSTRATE_SERVICES = ['api', 'web', 'llmup', 'universal-proxy'] as const;

function addFailure(failures: CheckFailure[], resourcePath: string, message: string): void {
  failures.push({ path: resourcePath, message });
}

function serviceMatchesForbidden(serviceName: string, forbidden: string): boolean {
  const normalized = serviceName.toLowerCase();
  const token = forbidden.replace('-', '[-_]');
  return new RegExp(`(?:^|[-_])${token}(?:$|[-_])`, 'u').test(normalized);
}

function initHelperOwner(serviceName: string): string | null {
  const suffixMatch = /^([a-z0-9][a-z0-9-]*)-init$/u.exec(serviceName);
  if (suffixMatch) {
    return suffixMatch[1];
  }

  const prefixMatch = /^init-([a-z0-9][a-z0-9-]*)$/u.exec(serviceName);
  return prefixMatch?.[1] ?? null;
}

function isAllowedInitHelperService(serviceName: string): boolean {
  const owner = initHelperOwner(serviceName);
  return owner !== null && REQUIRED_SUBSTRATE_SERVICE_SET.has(owner);
}

function recursivelyContainsString(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    return value.includes(expected);
  }
  if (Array.isArray(value)) {
    return value.some((item) => recursivelyContainsString(item, expected));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((nestedValue) =>
      recursivelyContainsString(nestedValue, expected),
    );
  }

  return false;
}

function serviceImage(service: Record<string, unknown>): string {
  return typeof service.image === 'string' ? service.image : '';
}

function serviceEnvironment(service: Record<string, unknown>): Record<string, string> {
  const environment = service.environment;
  if (environment !== null && typeof environment === 'object' && !Array.isArray(environment)) {
    return Object.fromEntries(
      Object.entries(environment as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }

  return {};
}

export function checkSubstrateComposeText(
  source: string,
  sourcePath = DEFAULT_SUBSTRATE_COMPOSE_PATH,
): CheckResult {
  const failures: CheckFailure[] = [];
  const document = YAML.parseDocument(source);

  for (const error of document.errors) {
    addFailure(failures, sourcePath, `Docker substrate compose must parse as YAML: ${error.message}`);
  }

  const compose = asRecord(document.toJSON());
  const services = asRecord(compose.services);
  const serviceNames = Object.keys(services);

  if (serviceNames.length === 0) {
    addFailure(failures, `${sourcePath}:services`, 'Docker substrate compose must declare services');
  }

  for (const required of REQUIRED_SUBSTRATE_SERVICES) {
    if (!Object.prototype.hasOwnProperty.call(services, required)) {
      addFailure(failures, `${sourcePath}:services.${required}`, `${required} must be a Docker substrate service`);
    }
  }

  for (const serviceName of serviceNames) {
    for (const forbidden of FORBIDDEN_DOCKER_SUBSTRATE_SERVICES) {
      if (serviceMatchesForbidden(serviceName, forbidden)) {
        addFailure(failures, `${sourcePath}:services.${serviceName}`, `${serviceName} must not be a Docker substrate service`);
      }
    }

    if (REQUIRED_SUBSTRATE_SERVICE_SET.has(serviceName) || isAllowedInitHelperService(serviceName)) {
      continue;
    }

    addFailure(
      failures,
      `${sourcePath}:services.${serviceName}`,
      `${serviceName} is not an allowed Docker substrate member or init helper`,
    );
  }

  const redis = asRecord(services.redis);
  if (Object.keys(redis).length > 0) {
    if (!recursivelyContainsString(redis, 'requirepass')) {
      addFailure(failures, `${sourcePath}:services.redis`, 'redis must enable requirepass because substrate truth requires SUBSTRATE_REDIS_PASSWORD');
    }
    if (!recursivelyContainsString(redis, 'SUBSTRATE_REDIS_PASSWORD')) {
      addFailure(failures, `${sourcePath}:services.redis`, 'redis requirepass must use SUBSTRATE_REDIS_PASSWORD');
    }
  }

  const postgresql = asRecord(services.postgresql);
  if (Object.keys(postgresql).length > 0 && !serviceImage(postgresql).startsWith('pgvector/pgvector:')) {
    addFailure(failures, `${sourcePath}:services.postgresql.image`, 'postgresql must use a pgvector-capable image');
  }

  const keycloak = asRecord(services.keycloak);
  const keycloakEnvironment = serviceEnvironment(keycloak);
  const minio = asRecord(services.minio);
  if (Object.keys(minio).length > 0) {
    if (!recursivelyContainsString(minio, 'curl -fsS http://localhost:9000/minio/health/live')) {
      addFailure(failures, `${sourcePath}:services.minio.healthcheck`, 'minio healthcheck must use the HTTP live endpoint');
    }
    if (recursivelyContainsString(asRecord(minio.healthcheck), 'mc ready')) {
      addFailure(failures, `${sourcePath}:services.minio.healthcheck`, 'minio healthcheck must not depend on mc inside the server image');
    }
  }

  if (Object.keys(keycloak).length > 0) {
    if (keycloakEnvironment.KC_BOOTSTRAP_ADMIN_USERNAME !== '${SUBSTRATE_KEYCLOAK_ADMIN:?SUBSTRATE_KEYCLOAK_ADMIN must be set}') {
      addFailure(failures, `${sourcePath}:services.keycloak.environment.KC_BOOTSTRAP_ADMIN_USERNAME`, 'keycloak admin username must come from required substrate truth');
    }
    if (keycloakEnvironment.KC_BOOTSTRAP_ADMIN_PASSWORD !== '${SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD:?SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD must be set}') {
      addFailure(failures, `${sourcePath}:services.keycloak.environment.KC_BOOTSTRAP_ADMIN_PASSWORD`, 'keycloak admin password must come from required substrate truth');
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function readTextFile(filePath: string, failures: CheckFailure[]): string | null {
  if (!existsSync(filePath)) {
    addFailure(failures, filePath, 'required substrate boundary file must exist');
    return null;
  }

  return readFileSync(filePath, 'utf8');
}

function resolveRepoPath(inputPath: string | undefined, fallback: string): string {
  if (!inputPath) {
    return fallback;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(REPO_ROOT, inputPath);
}

export function checkSubstrateBoundary(options: SubstrateBoundaryOptions = {}): CheckResult {
  const failures: CheckFailure[] = [];
  const composePath = resolveRepoPath(options.composePath, DEFAULT_SUBSTRATE_COMPOSE_PATH);
  const truthPath = resolveRepoPath(options.truthPath, DEFAULT_SUBSTRATE_TRUTH_PATH);
  const composeSource = readTextFile(composePath, failures);
  const truthSource = readTextFile(truthPath, failures);

  if (composeSource) {
    failures.push(...checkSubstrateComposeText(composeSource, composePath).failures);
  }
  if (truthSource) {
    failures.push(...validateSubstrateTruthText(truthSource, { sourcePath: truthPath }).failures);
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function parseCliOptions(argv: readonly string[]): SubstrateBoundaryOptions {
  const options: SubstrateBoundaryOptions = {};

  for (const arg of argv) {
    if (arg.startsWith('--compose=')) {
      options.composePath = arg.slice('--compose='.length);
      continue;
    }
    if (arg.startsWith('--substrate-truth=')) {
      options.truthPath = arg.slice('--substrate-truth='.length);
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

async function main(): Promise<void> {
  const result = checkSubstrateBoundary(parseCliOptions(process.argv.slice(2)));

  if (!result.ok) {
    const evidence = await writeProducerEvidence({
      producer: 'substrate-boundary',
      status: 'failed',
      failures: result.failures,
    });
    process.stderr.write(`${result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n`);
    process.stderr.write(`[unified-deploy] evidence: ${evidence.paths.report_path}\n`);
    process.exitCode = 1;
    return;
  }

  const evidence = await writeProducerEvidence({
    producer: 'substrate-boundary',
    status: 'passed',
    failures: [],
  });

  process.stdout.write(`[unified-deploy] substrate boundary check passed\n[unified-deploy] evidence: ${evidence.paths.report_path}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
