import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkAddressTruth, runAddressTruthProducer } from './check-address-truth';
import { renderUnifiedDeployFromFiles, renderUnifiedDeployToString } from './render';

const tempRoots: string[] = [];
const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function removeLine(source: string, key: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(`${key}:`))
    .join('\n');
}

function removeEnvAssignment(source: string, key: string): string {
  return source
    .split('\n')
    .filter((line) => !line.startsWith(`${key}=`))
    .join('\n');
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'address-truth-producer-'));
  tempRoots.push(root);
  return root;
}

describe('unified deploy address truth producer', () => {
  it.each(['local-kind', 'existing-cluster'] as const)(
    'accepts rendered canonical API address truth for %s',
    async (profile) => {
      const rendered = await renderUnifiedDeployFromFiles({ profile });

      expect(checkAddressTruth(rendered.output).ok).toBe(true);
      expect(rendered.output).toContain('PUBLIC_API_BASE_URL: "http://agentsmith.localtest.me:29180/api/v1"');
      expect(rendered.output).toContain('INTERNAL_API_BASE_URL: "http://agentsmith-api:20000/api/v1"');
      expect(rendered.output).toContain('AGENT_EXECUTION_HTTP_BASE_URL: "http://agentsmith-api:20000/api/v1"');
      expect(rendered.output).toContain('AGENT_EXECUTION_WS_BASE_URL: "ws://agentsmith-api:20000"');
      expect(rendered.output).toContain('SANDBOX_MANAGER_URL: "http://agentsmith-sandbox-manager:8080"');
      expect(rendered.output).toContain('MBOS_UNIVERSAL_PROXY_BASE_URL: "http://agentsmith-llmup:8080"');
      expect(rendered.output).toContain('INTERNAL_KEYCLOAK_BASE_URL: "http://substrate-keycloak:8080"');
      expect(rendered.output).toContain('MINIO_PORT: "9000"');
      expect(rendered.output).toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE: "substrate-postgresql.agentsmith.svc.cluster.local"');
      expect(rendered.output).toContain('INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE: "5432"');
      expect(rendered.output).toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT: "http://substrate-minio.agentsmith.svc.cluster.local:9000"');
      expect(rendered.output).toContain('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:');
      expect(rendered.output).toContain('SANDBOX_SERVICE_KEY:');
      expect(rendered.output).not.toContain('@substrate-postgresql:15432/');
      expect(rendered.output).not.toContain('@substrate-mongodb:27027/');
      expect(rendered.output).not.toContain('@substrate-redis:16379/');
      expect(rendered.output).not.toContain('SANDBOX_MANAGER_INTERNAL_BASE_URL');
      expect(rendered.output).not.toContain('SUBSTRATE_MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
      expect(rendered.output).not.toContain('SUBSTRATE_SANDBOX_SERVICE_KEY');
    },
  );

  it('rejects missing app-owned sandbox and llmup secrets', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const withoutSandboxKey = removeLine(rendered.output, 'SANDBOX_SERVICE_KEY');
    const withoutLlmupToken = removeLine(rendered.output, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');

    expect(checkAddressTruth(withoutSandboxKey).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Secret/agentsmith-app-secrets',
        message: expect.stringContaining('SANDBOX_SERVICE_KEY'),
      }),
    ]));
    expect(checkAddressTruth(withoutLlmupToken).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Secret/agentsmith-app-secrets',
        message: expect.stringContaining('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN'),
      }),
    ]));
  });

  it('rejects missing managed execution API bases', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const withoutHttpBase = removeLine(rendered.output, 'AGENT_EXECUTION_HTTP_BASE_URL');
    const withoutWsBase = removeLine(rendered.output, 'AGENT_EXECUTION_WS_BASE_URL');

    expect(checkAddressTruth(withoutHttpBase).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'ConfigMap/agentsmith-app-config',
        message: expect.stringContaining('AGENT_EXECUTION_HTTP_BASE_URL'),
      }),
    ]));
    expect(checkAddressTruth(withoutWsBase).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'ConfigMap/agentsmith-app-config',
        message: expect.stringContaining('AGENT_EXECUTION_WS_BASE_URL'),
      }),
    ]));
  });

  it('rejects address truth that points llmup or sandbox to the wrong service', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const wrongLlmup = rendered.output.replace(
      'MBOS_UNIVERSAL_PROXY_BASE_URL: "http://agentsmith-llmup:8080"',
      'MBOS_UNIVERSAL_PROXY_BASE_URL: "http://agentsmith-web:3001"',
    );
    const wrongSandbox = rendered.output.replace(
      'SANDBOX_MANAGER_URL: "http://agentsmith-sandbox-manager:8080"',
      'SANDBOX_MANAGER_URL: "http://agentsmith-api:20000"',
    );

    expect(checkAddressTruth(wrongLlmup).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'ConfigMap/agentsmith-app-config',
        message: expect.stringContaining('MBOS_UNIVERSAL_PROXY_BASE_URL'),
      }),
    ]));
    expect(checkAddressTruth(wrongSandbox).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'ConfigMap/agentsmith-app-config',
        message: expect.stringContaining('SANDBOX_MANAGER_URL'),
      }),
    ]));
  });

  it('rejects app dependency config that reuses Docker substrate target ports', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const withExternalPorts = rendered.output
      .replace('@substrate-postgresql:5432/', '@substrate-postgresql:15432/')
      .replace('@substrate-mongodb:27017/', '@substrate-mongodb:27027/')
      .replace('@substrate-redis:6379/0', '@substrate-redis:16379/0')
      .replace('MINIO_PORT: "9000"', 'MINIO_PORT: "19000"')
      .replace(
        'INTERNAL_KEYCLOAK_BASE_URL: "http://substrate-keycloak:8080"',
        'INTERNAL_KEYCLOAK_BASE_URL: "http://substrate-keycloak:18080"',
      );

    expect(checkAddressTruth(withExternalPorts).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Secret/agentsmith-app-secrets',
        message: expect.stringContaining('DATABASE_URL must use substrate-postgresql:5432'),
      }),
      expect.objectContaining({
        path: 'Secret/agentsmith-app-secrets',
        message: expect.stringContaining('MONGO_URL must use substrate-mongodb:27017'),
      }),
      expect.objectContaining({
        path: 'Secret/agentsmith-app-secrets',
        message: expect.stringContaining('REDIS_URL must use substrate-redis:6379'),
      }),
      expect.objectContaining({
        path: 'ConfigMap/agentsmith-app-config',
        message: expect.stringContaining('MINIO_PORT must be 9000'),
      }),
      expect.objectContaining({
        path: 'ConfigMap/agentsmith-app-config',
        message: expect.stringContaining('INTERNAL_KEYCLOAK_BASE_URL must be http://substrate-keycloak:8080'),
      }),
    ]));
  });

  it('rejects public API or execution bases that cannot route to /api/v1 agent execution', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const publicWithoutApiPrefix = rendered.output.replace(
      'PUBLIC_API_BASE_URL: "http://agentsmith.localtest.me:29180/api/v1"',
      'PUBLIC_API_BASE_URL: "http://agentsmith.localtest.me:29180"',
    );
    const executionWithoutApiPrefix = rendered.output.replace(
      'AGENT_EXECUTION_HTTP_BASE_URL: "http://agentsmith-api:20000/api/v1"',
      'AGENT_EXECUTION_HTTP_BASE_URL: "http://agentsmith-api:20000"',
    );
    const ingressToWeb = rendered.output.replace(
      /path: \/api\/v1\n            pathType: Prefix\n            backend:\n              service:\n                name: agentsmith-api/u,
      'path: /api/v1\n            pathType: Prefix\n            backend:\n              service:\n                name: agentsmith-web',
    );

    expect(checkAddressTruth(publicWithoutApiPrefix).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'ConfigMap/agentsmith-app-config',
        message: expect.stringContaining('PUBLIC_API_BASE_URL'),
      }),
    ]));
    expect(checkAddressTruth(executionWithoutApiPrefix).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'ConfigMap/agentsmith-app-config',
        message: expect.stringContaining('AGENT_EXECUTION_HTTP_BASE_URL'),
      }),
    ]));
    expect(checkAddressTruth(ingressToWeb).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Ingress/agentsmith',
        message: expect.stringContaining('/api/v1'),
      }),
    ]));
  });

  it('keeps app-owned address secrets out of Docker substrate truth schema and examples', async () => {
    const manifest = JSON.parse(await readFile('infra/deploy/unified/deployment.manifest.json', 'utf8')) as {
      substrate?: {
        truth_schema?: {
          required_env?: string[];
        };
      };
    };
    const substrateExample = await readFile('infra/deploy/unified/substrate/connection.env.example', 'utf8');
    const requiredEnv = manifest.substrate?.truth_schema?.required_env ?? [];

    expect(requiredEnv).not.toContain('SANDBOX_SERVICE_KEY');
    expect(requiredEnv).not.toContain('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
    expect(substrateExample).not.toContain('SANDBOX_SERVICE_KEY');
    expect(substrateExample).not.toContain('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
  });

  it('keeps selectorless EndpointSlice addressType aligned with IPv4 substrate truth', async () => {
    const substrateTruth = (await readFile(join(fixturesDir, 'substrate-truth.sentinel.env'), 'utf8'))
      .replace(/^SUBSTRATE_POSTGRES_HOST=.*$/mu, 'SUBSTRATE_POSTGRES_HOST=172.19.0.1')
      .replace(/^SUBSTRATE_MONGODB_HOST=.*$/mu, 'SUBSTRATE_MONGODB_HOST=172.19.0.1')
      .replace(/^SUBSTRATE_REDIS_HOST=.*$/mu, 'SUBSTRATE_REDIS_HOST=172.19.0.1')
      .replace(/^SUBSTRATE_MINIO_HOST=.*$/mu, 'SUBSTRATE_MINIO_HOST=172.19.0.1')
      .replace(/^SUBSTRATE_KEYCLOAK_HOST=.*$/mu, 'SUBSTRATE_KEYCLOAK_HOST=172.19.0.1');
    const rendered = await renderUnifiedDeployToString({
      profile: 'local-kind',
      substrateTruth,
    });

    expect(rendered.output).toMatch(/name: substrate-mongodb[\s\S]*addressType: IPv4[\s\S]*- "172\.19\.0\.1"/u);
    expect(checkAddressTruth(rendered.output).ok).toBe(true);
  });

  it('rejects FQDN substrate EndpointSlice bindings instead of reporting fake kube-proxy support', async () => {
    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'existing-cluster',
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const fqdnEndpointSlice = rendered.output
      .replace(/addressType: IPv4/u, 'addressType: FQDN')
      .replace('- "198.51.100.31"', '- "sentinel-postgresql.truth.example"');

    expect(checkAddressTruth(fqdnEndpointSlice).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'EndpointSlice/substrate-postgresql',
        message: expect.stringContaining('FQDN substrate EndpointSlice is not supported'),
      }),
    ]));
  });

  it('fails render when required app-owned address secrets are absent from site env', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const siteEnv = await readFile(rendered.siteEnvPath, 'utf8');
    const missingSecrets = siteEnv
      .split('\n')
      .filter((line) =>
        !line.startsWith('SANDBOX_SERVICE_KEY=') && !line.startsWith('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN='),
      )
      .join('\n');

    await expect(renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv: missingSecrets,
    })).rejects.toThrow(/SANDBOX_SERVICE_KEY|MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN/u);
  });

  it('writes failed producer evidence when app site env parsing fails before address checks', async () => {
    const root = await createTempRoot();
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const siteEnvPath = join(root, 'site.env');
    await writeFile(
      siteEnvPath,
      removeEnvAssignment(await readFile(rendered.siteEnvPath, 'utf8'), 'SANDBOX_SERVICE_KEY'),
      'utf8',
    );

    const result = await runAddressTruthProducer({
      profiles: ['local-kind'],
      siteEnvPath,
      evidenceDir: root,
    });
    const report = JSON.parse(await readFile(result.evidence.paths.report_path, 'utf8')) as {
      producer?: string;
      status?: string;
      failures?: Array<{ path?: string; message?: string }>;
    };

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'local-kind:render',
        message: expect.stringContaining('SANDBOX_SERVICE_KEY'),
      }),
    ]));
    expect(report.producer).toBe('address-truth');
    expect(report.status).toBe('failed');
    expect(report.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'local-kind:render',
        message: expect.stringContaining('SANDBOX_SERVICE_KEY'),
      }),
    ]));
  });

  it('writes failed producer evidence when substrate truth parsing fails before address checks', async () => {
    const root = await createTempRoot();
    const substrateTruthPath = join(root, 'connection.env');
    await writeFile(
      substrateTruthPath,
      `${await readFile(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')}
NAMESPACE=agentsmith-override
`,
      'utf8',
    );

    const result = await runAddressTruthProducer({
      profiles: ['local-kind'],
      substrateTruthPath,
      evidenceDir: root,
    });
    const report = JSON.parse(await readFile(result.evidence.paths.report_path, 'utf8')) as {
      producer?: string;
      status?: string;
      failures?: Array<{ path?: string; message?: string }>;
    };

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'local-kind:render',
        message: expect.stringContaining('NAMESPACE is not allowed in Docker substrate truth'),
      }),
    ]));
    expect(report.producer).toBe('address-truth');
    expect(report.status).toBe('failed');
    expect(report.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'local-kind:render',
        message: expect.stringContaining('NAMESPACE is not allowed in Docker substrate truth'),
      }),
    ]));
  });
});
