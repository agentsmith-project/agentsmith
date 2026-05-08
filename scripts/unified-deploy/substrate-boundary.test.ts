import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SUBSTRATE_COMPOSE_PATH,
  DEFAULT_SUBSTRATE_TRUTH_PATH,
  checkSubstrateBoundary,
  checkSubstrateComposeText,
} from './check-substrate-boundary';
import {
  parseSubstrateTruth,
  redactedSubstrateTruthFingerprint,
  validateSubstrateTruthText,
} from './substrate-truth';
import { DEFAULT_SUBSTRATE_INTERNAL_NO_PROXY_HOSTS } from './substrate-lifecycle';

const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');

describe('unified deploy Docker substrate boundary producer', () => {
  it('accepts the target Docker-only compose file and connection truth example', () => {
    const composeText = readFileSync(DEFAULT_SUBSTRATE_COMPOSE_PATH, 'utf8');
    const result = checkSubstrateBoundary({
      composePath: DEFAULT_SUBSTRATE_COMPOSE_PATH,
      truthPath: DEFAULT_SUBSTRATE_TRUTH_PATH,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);

    const truth = parseSubstrateTruth(readFileSync(DEFAULT_SUBSTRATE_TRUTH_PATH, 'utf8'));
    expect(truth.schema_version).toBe('agentsmith.docker-substrate.truth/v1');
    expect(truth.values.SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL).toBe('http://substrate-keycloak:8080');
    expect(truth.values.SUBSTRATE_KEYCLOAK_ADMIN).toBe('agentsmith-admin');
    expect(composeText).toContain('image: pgvector/pgvector:pg16');
    expect(composeText).toContain('curl -fsS http://localhost:9000/minio/health/live');
    expect(composeText).not.toContain('mc\", \"ready\"');
    expect(composeText).toContain('KC_BOOTSTRAP_ADMIN_PASSWORD: ${SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD:?SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD must be set}');
    expect(composeText).not.toContain('KC_BOOTSTRAP_ADMIN_PASSWORD: ${SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD:-admin}');
    expect(redactedSubstrateTruthFingerprint(truth.values)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(truth.redacted_values)).not.toContain('agentsmith_dev_password');
  });

  it('requires every Docker substrate service to bypass proxies for internal service names', () => {
    const composeText = readFileSync(DEFAULT_SUBSTRATE_COMPOSE_PATH, 'utf8');

    for (const host of DEFAULT_SUBSTRATE_INTERNAL_NO_PROXY_HOSTS) {
      expect(composeText).toContain(host);
    }
    expect(composeText).toContain('NO_PROXY:');
    expect(composeText).toContain('no_proxy:');
    expect(composeText).toContain('SUBSTRATE_INTERNAL_NO_PROXY');
  });

  it('rejects app or proxy services in the Docker substrate compose file', () => {
    const result = checkSubstrateComposeText(
      readFileSync(join(fixturesDir, 'substrate-compose.with-api-web-proxy.yml'), 'utf8'),
      'substrate-compose.with-api-web-proxy.yml',
    );
    const text = result.failures.map((failure) => failure.message).join('\n');

    expect(result.ok).toBe(false);
    expect(text).toContain('api must not be a Docker substrate service');
    expect(text).toContain('web must not be a Docker substrate service');
    expect(text).toContain('llmup must not be a Docker substrate service');
    expect(text).toContain('universal-proxy must not be a Docker substrate service');
  });

  it('rejects app init helpers that are not owned by substrate services', () => {
    const result = checkSubstrateComposeText(
      readFileSync(join(fixturesDir, 'substrate-compose.with-app-init-helpers.yml'), 'utf8'),
      'substrate-compose.with-app-init-helpers.yml',
    );
    const text = result.failures.map((failure) => failure.message).join('\n');

    expect(result.ok).toBe(false);
    expect(text).toContain('api-init must not be a Docker substrate service');
    expect(text).toContain('init-web must not be a Docker substrate service');
    expect(text).toContain('llmup-init must not be a Docker substrate service');
    expect(text).toContain('universal-proxy-init must not be a Docker substrate service');
    expect(text).not.toContain('minio-init is not an allowed Docker substrate member or init helper');
  });

  it('rejects proxy and llmup keys or values in substrate truth', () => {
    const result = validateSubstrateTruthText(
      readFileSync(join(fixturesDir, 'substrate-truth.with-proxy.env'), 'utf8'),
      { sourcePath: 'substrate-truth.with-proxy.env' },
    );
    const text = result.failures.map((failure) => failure.message).join('\n');

    expect(result.ok).toBe(false);
    expect(text).toContain('MBOS_UNIVERSAL_PROXY_BASE_URL is not allowed in Docker substrate truth');
    expect(text).toContain('SUBSTRATE_FORBIDDEN_SENTINEL value must not reference llmup or universal-proxy');
  });

  it('rejects app-owned sandbox secrets in substrate truth', () => {
    const source = `${readFileSync(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')}
SANDBOX_SERVICE_KEY=substrate_should_not_override_app_secret
`;
    const result = validateSubstrateTruthText(source, { sourcePath: 'substrate-truth.with-sandbox-secret.env' });
    const text = result.failures.map((failure) => failure.message).join('\n');

    expect(result.ok).toBe(false);
    expect(text).toContain('SANDBOX_SERVICE_KEY is not allowed in Docker substrate truth');
  });

  it.each([
    ['PUBLIC_BASE_URL', 'http://agentsmith.localtest.me:29180'],
    ['NAMESPACE', 'agentsmith-override'],
    ['WEB_IMAGE', 'ghcr.io/mbos/wrong-web:dev'],
    ['UNIFIED_DEPLOY_PROFILE', 'existing-cluster'],
    ['SANDBOX_MANAGER_URL', 'http://agentsmith-sandbox-manager:8080'],
    ['AGENT_EXECUTION_HTTP_BASE_URL', 'http://agentsmith-api:20000/api/v1'],
    ['AGENT_EXECUTION_WS_BASE_URL', 'ws://agentsmith-api:20000'],
    ['INTERNAL_API_BASE_URL', 'http://agentsmith-api:20000/api/v1'],
    ['PUBLIC_API_BASE_URL', 'http://agentsmith.localtest.me:29180/api/v1'],
    ['RUNNER_PUBLIC_API_BASE_URL', 'ws://agentsmith.localtest.me:29180/api/v1'],
  ])('rejects app-owned address key %s in substrate truth', (key, value) => {
    const source = `${readFileSync(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')}
${key}=${value}
`;
    const result = validateSubstrateTruthText(source, { sourcePath: `substrate-truth.with-${key}.env` });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.message).join('\n')).toContain(
      `${key} is not allowed in Docker substrate truth`,
    );
  });

  it('rejects substrate truth missing a required handoff key', () => {
    const source = readFileSync(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')
      .replace(/^SUBSTRATE_REDIS_PASSWORD=.*\n/mu, '');
    const result = validateSubstrateTruthText(source, { sourcePath: 'missing-redis.env' });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.message).join('\n')).toContain(
      'missing Docker substrate truth values: SUBSTRATE_REDIS_PASSWORD',
    );
  });

  it('keeps the Docker substrate truth schema independent from weak app manifest requirements', () => {
    const source = readFileSync(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')
      .replace(/^SUBSTRATE_MINIO_SECRET_KEY=.*\n/mu, '');
    const result = validateSubstrateTruthText(source, {
      sourcePath: 'weak-manifest.env',
      requiredEnv: [],
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.message).join('\n')).toContain(
      'missing Docker substrate truth values: SUBSTRATE_MINIO_SECRET_KEY',
    );
  });

  it('requires the Keycloak internal base URL to match the Kubernetes Service native port', () => {
    const source = readFileSync(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')
      .replace(
        /^SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL=.*$/mu,
        'SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL=http://substrate-keycloak:18080',
      );
    const result = validateSubstrateTruthText(source, { sourcePath: 'keycloak-port-mismatch.env' });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.message).join('\n')).toContain(
      'SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL must be http://substrate-keycloak:8080',
    );
  });

  it.each([
    ['IPv4', '172.19.0.1'],
    ['IPv6', 'fd00:10::12'],
  ])('accepts %s substrate hosts for selectorless Service EndpointSlice rendering', (_kind, host) => {
    const source = readFileSync(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')
      .replace(/^SUBSTRATE_POSTGRES_HOST=.*$/mu, `SUBSTRATE_POSTGRES_HOST=${host}`)
      .replace(/^SUBSTRATE_MONGODB_HOST=.*$/mu, `SUBSTRATE_MONGODB_HOST=${host}`)
      .replace(/^SUBSTRATE_REDIS_HOST=.*$/mu, `SUBSTRATE_REDIS_HOST=${host}`)
      .replace(/^SUBSTRATE_MINIO_HOST=.*$/mu, `SUBSTRATE_MINIO_HOST=${host}`)
      .replace(/^SUBSTRATE_KEYCLOAK_HOST=.*$/mu, `SUBSTRATE_KEYCLOAK_HOST=${host}`);
    const result = validateSubstrateTruthText(source, { sourcePath: `${host}.env` });

    expect(result.ok).toBe(true);
  });

  it('rejects FQDN substrate hosts for v1 selectorless Service EndpointSlice bindings', () => {
    const source = readFileSync(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')
      .replace(/^SUBSTRATE_POSTGRES_HOST=.*$/mu, 'SUBSTRATE_POSTGRES_HOST=valid-postgresql.substrate.example')
      .replace(/^SUBSTRATE_MONGODB_HOST=.*$/mu, 'SUBSTRATE_MONGODB_HOST=valid-mongodb.substrate.example')
      .replace(/^SUBSTRATE_REDIS_HOST=.*$/mu, 'SUBSTRATE_REDIS_HOST=valid-redis.substrate.example')
      .replace(/^SUBSTRATE_MINIO_HOST=.*$/mu, 'SUBSTRATE_MINIO_HOST=valid-minio.substrate.example')
      .replace(/^SUBSTRATE_KEYCLOAK_HOST=.*$/mu, 'SUBSTRATE_KEYCLOAK_HOST=valid-keycloak.substrate.example');
    const result = validateSubstrateTruthText(source, { sourcePath: 'fqdn-substrate.env' });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.message).join('\n')).toContain(
      'substrate binding host must be an IPv4 or IPv6 address',
    );
  });
});
