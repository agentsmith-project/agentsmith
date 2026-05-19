import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkLocalKindImagePreflight,
  parseAsbcpImageLock,
  parseLlmupImageLock,
  runLocalKindImagesProducer,
  type LocalKindImageCommandRunner,
} from './check-local-kind-images';

const tempRoots: string[] = [];

type CommandCall = {
  command: string;
  args: string[];
};

const APP_DIGEST = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ASBCP_DIGEST = 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const LLMUP_DIGEST = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const INGRESS_CONTROLLER_DIGEST = 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const INGRESS_CERTGEN_DIGEST = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const MANAGED_RUNNER_DIGEST = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';
const AFSCP_DIGEST = 'sha256:abababababababababababababababababababababababababababababababab';

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function createAsbcpImageLock(root: string, content = `\
asbcp_version=v0.1.0
asbcp_source_image=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.1.0@${ASBCP_DIGEST}
asbcp_release_url=https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/v0.1.0
asbcp_commit_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`): string {
  const lockPath = join(root, 'asbcp-image.lock');
  writeFileSync(lockPath, content, 'utf8');
  return lockPath;
}

function registryDigestForRef(ref: string): string {
  if (ref.includes('/agentsmith-app:')) {
    return APP_DIGEST;
  }
  if (ref.includes('/agentsmith-sandbox-control-plane:')) {
    return ASBCP_DIGEST;
  }
  if (ref.includes('/llm-universal-proxy:')) {
    return LLMUP_DIGEST;
  }
  if (ref.includes('/agentsmith-fs-control-plane:')) {
    return AFSCP_DIGEST;
  }
  if (ref.includes('/ingress-nginx-controller:')) {
    return INGRESS_CONTROLLER_DIGEST;
  }
  if (ref.includes('/ingress-nginx-kube-webhook-certgen:')) {
    return INGRESS_CERTGEN_DIGEST;
  }
  if (ref.includes('/agentsmith-managed-runner:')) {
    return MANAGED_RUNNER_DIGEST;
  }
  return 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
}

function appDockerfileBuildContextCopySources(): Array<{ line: number; source: string }> {
  const dockerfile = readFileSync(join(process.cwd(), 'infra', 'deploy', 'Dockerfile.agentsmith-app'), 'utf8');

  return dockerfile.split('\n').flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('COPY ')) {
      return [];
    }

    const parts = trimmed.split(/\s+/u).slice(1);
    const flags: string[] = [];
    while (parts[0]?.startsWith('--')) {
      const flag = parts.shift();
      if (flag) {
        flags.push(flag);
      }
    }
    if (flags.some((flag) => flag.startsWith('--from='))) {
      return [];
    }

    return parts.slice(0, -1).map((source) => ({ line: index + 1, source }));
  });
}

function successfulRunner(calls: CommandCall[]): LocalKindImageCommandRunner {
  return async (command, args) => {
    calls.push({ command, args });
    const joined = args.join(' ');
    if (joined.includes('network inspect kind')) {
      return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
    }
    if (joined.includes('buildx imagetools inspect')) {
      const imageRef = args[args.length - 1] ?? '';
      return { exitCode: 0, stdout: `Name: ${imageRef}\nDigest: ${registryDigestForRef(imageRef)}\n`, stderr: '' };
    }
    if (joined.includes('image inspect')) {
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    }
    if (args.includes('ps')) {
      return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
    }

    return { exitCode: 0, stdout: 'ok', stderr: '' };
  };
}

function testRegistryAvailabilityPoll(timeoutMs = 2, intervalMs = 1): {
  poll: {
    timeoutMs: number;
    intervalMs: number;
    now: () => number;
    sleep: (durationMs: number) => Promise<void>;
  };
  sleeps: number[];
} {
  let now = 0;
  const sleeps: number[] = [];

  return {
    poll: {
      timeoutMs,
      intervalMs,
      now: () => now,
      sleep: async (durationMs: number) => {
        sleeps.push(durationMs);
        now += Math.max(durationMs, 1);
      },
    },
    sleeps,
  };
}

function yamlStringList(values: readonly string[]): string {
  return values.map((value) => `            - ${value}`).join('\n');
}

function afscpBootstrapJobsYaml(options: {
  schemaCommand?: string[];
  schemaArgs?: string[];
  volumeCommand?: string[];
  volumeArgs?: string[];
  image?: string;
} = {}): string {
  const image = options.image ?? `kind-registry:5000/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST}`;
  const schemaCommand = options.schemaCommand ?? ['/usr/local/bin/afscp-migrate'];
  const schemaArgs = options.schemaArgs ?? ['--apply', '--check', '--timeout=60s'];
  const volumeCommand = options.volumeCommand ?? ['/usr/local/bin/afscp-volume-bootstrap'];
  const volumeArgs = options.volumeArgs ?? ['--ensure', '--check', '--timeout=60s'];

  return `\
apiVersion: batch/v1
kind: Job
metadata:
  name: afscp-schema-bootstrap
spec:
  template:
    spec:
      containers:
        - name: afscp-schema-bootstrap
          image: ${image}
          command:
${yamlStringList(schemaCommand)}
          args:
${yamlStringList(schemaArgs)}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: afscp-volume-bootstrap
spec:
  template:
    spec:
      containers:
        - name: afscp-volume-bootstrap
          image: ${image}
          command:
${yamlStringList(volumeCommand)}
          args:
${yamlStringList(volumeArgs)}
`;
}

function afscpCommandContractRunner(calls: CommandCall[]): LocalKindImageCommandRunner {
  return async (command, args) => {
    calls.push({ command, args });
    const joined = args.join(' ');
    if (joined.includes('network inspect kind')) {
      return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
    }
    if (joined.includes('buildx imagetools inspect')) {
      const imageRef = args[args.length - 1] ?? '';
      return { exitCode: 0, stdout: `Name: ${imageRef}\nDigest: ${registryDigestForRef(imageRef)}\n`, stderr: '' };
    }
    if (args.includes('ps')) {
      return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
    }
    if (args.includes('exec') && args.includes('agentsmith-control-plane')) {
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    }
    if (args[0] === 'run') {
      const entrypointIndex = args.indexOf('--entrypoint');
      const entrypoint = entrypointIndex >= 0 ? args[entrypointIndex + 1] ?? '' : '';
      const imageIndex = entrypointIndex + 2;
      const commandArgs = args.slice(imageIndex + 1);
      if (entrypoint === '/usr/local/bin/afscp-migrate') {
        if (!commandArgs.includes('--apply') && !commandArgs.includes('--check')) {
          return { exitCode: 2, stdout: '', stderr: 'afscp-migrate: --apply or --check is required' };
        }
        return { exitCode: 2, stdout: '', stderr: 'afscp-migrate: AFSCP_MIGRATION_POSTGRES_DSN, AFSCP_POSTGRES_DSN, or AFSCP_DATABASE_URL is required' };
      }
      if (entrypoint === '/usr/local/bin/afscp-volume-bootstrap') {
        if (commandArgs.includes('--apply')) {
          return { exitCode: 2, stdout: '', stderr: 'flag provided but not defined: -apply' };
        }
        if (!commandArgs.includes('--ensure') && !commandArgs.includes('--check')) {
          return { exitCode: 2, stdout: '', stderr: 'afscp-volume-bootstrap: --ensure or --check is required' };
        }
        return { exitCode: 2, stdout: '', stderr: 'afscp-volume-bootstrap: AFSCP_VOLUME_BOOTSTRAP_POSTGRES_DSN, AFSCP_POSTGRES_DSN, or AFSCP_DATABASE_URL is required' };
      }
    }

    return { exitCode: 0, stdout: 'ok', stderr: '' };
  };
}

describe('unified deploy local-kind image truth producer', () => {
  it('parses the locked llmup source image and version', () => {
    const lock = parseLlmupImageLock(`\
llmup_version=v0.2.27
llmup_source_image=ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.27@sha256:4996453b1353868ca9e99c584719c9905e1ebbbd6d2ff585378bc0050989583b
`);

    expect(lock.version).toBe('v0.2.27');
    expect(lock.source_image).toContain('llm-universal-proxy:v0.2.27@sha256:');
    expect(lock.host_image).toBe('localhost:5001/mbos/llm-universal-proxy:v0.2.27');
    expect(lock.k8s_image).toBe('kind-registry:5000/mbos/llm-universal-proxy:v0.2.27');
  });

  it('parses the locked ASBCP source image and requires canonical release provenance', () => {
    const lock = parseAsbcpImageLock(`\
asbcp_version=v0.1.0
asbcp_source_image=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.1.0@${ASBCP_DIGEST}
asbcp_release_url=https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/v0.1.0
asbcp_commit_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`);

    expect(lock.version).toBe('v0.1.0');
    expect(lock.source_image).toContain('agentsmith-sandbox-control-plane:v0.1.0@sha256:');
    expect(lock.release_url).toBe('https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/v0.1.0');
    expect(lock.commit_sha).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(lock.host_image).toBe('localhost:5001/mbos/agentsmith-sandbox-control-plane:v0.1.0');
    expect(lock.k8s_image).toBe('kind-registry:5000/mbos/agentsmith-sandbox-control-plane:v0.1.0');

    expect(() => parseAsbcpImageLock(`\
asbcp_version=v0.1.0
asbcp_source_image=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.1.0
asbcp_release_url=https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/v0.1.0
asbcp_commit_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`)).toThrow(/sha256 digest/u);
    expect(() => parseAsbcpImageLock(`\
asbcp_version=v0.1.0
asbcp_source_image=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.1.0@sha256:1111111111111111111111111111111111111111111111111111111111111111
asbcp_release_url=https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/v0.1.0
asbcp_commit_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`)).toThrow(/placeholder digest/u);
    expect(() => parseAsbcpImageLock(`\
asbcp_version=v0.1.0
asbcp_source_image=ghcr.io/example/agentsmith-sandbox-control-plane:v0.1.0@${ASBCP_DIGEST}
asbcp_release_url=https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/v0.1.0
asbcp_commit_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`)).toThrow(/canonical GHCR/u);
    expect(() => parseAsbcpImageLock(`\
asbcp_version=v0.1.0
asbcp_source_image=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.1.0@${ASBCP_DIGEST}
asbcp_commit_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`)).toThrow(/asbcp_release_url/u);
    expect(() => parseAsbcpImageLock(`\
asbcp_version=v0.1.0
asbcp_source_image=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.1.0@${ASBCP_DIGEST}
asbcp_release_url=https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/v0.1.0
asbcp_commit_sha=not-a-sha
`)).toThrow(/asbcp_commit_sha/u);
    expect(() => parseAsbcpImageLock(`\
asbcp_version=0.1.0
asbcp_source_image=ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:0.1.0@${ASBCP_DIGEST}
asbcp_release_url=https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/0.1.0
asbcp_commit_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`)).toThrow(/asbcp_version.*v/u);
  });

  it('keeps app Dockerfile build-context COPY sources present in the repo', () => {
    const missingSources = appDockerfileBuildContextCopySources()
      .filter(({ source }) => !existsSync(join(process.cwd(), source)));

    expect(missingSources).toEqual([]);
  });

  it('generates a local-kind site env with immutable K8s digest refs and records host push refs', async () => {
    const root = tempDir('local-kind-images-');
    const asbcpImageLockPath = createAsbcpImageLock(root);
    const evidenceDir = join(root, 'evidence');
    const calls: CommandCall[] = [];

    const result = await runLocalKindImagesProducer({
      evidenceDir,
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      asbcpImageLockPath,
      tag: 'test-tag',
      runner: successfulRunner(calls),
    });
    const siteEnv = readFileSync(result.evidence.generated_site_env_path, 'utf8');

    expect(result.status).toBe('passed');
    expect(siteEnv).toContain(`WEB_IMAGE=kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(siteEnv).toContain(`API_IMAGE=kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(siteEnv).toContain(`LLMUP_IMAGE=kind-registry:5000/mbos/llm-universal-proxy@${LLMUP_DIGEST}`);
    expect(siteEnv).toContain(`AFSCP_IMAGE=kind-registry:5000/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST}`);
    expect(siteEnv).toContain(`ASBCP_IMAGE=kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`);
    expect(siteEnv).toContain(`MANAGED_RUNNER_IMAGE=kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(siteEnv).toContain(`INGRESS_NGINX_CONTROLLER_IMAGE=kind-registry:5000/mbos/ingress-nginx-controller@${INGRESS_CONTROLLER_DIGEST}`);
    expect(siteEnv).toContain(`INGRESS_NGINX_CERTGEN_IMAGE=kind-registry:5000/mbos/ingress-nginx-kube-webhook-certgen@${INGRESS_CERTGEN_DIGEST}`);
    expect(siteEnv).not.toContain('kind-registry:5000/mbos/agentsmith-app:test-tag');
    expect(siteEnv).not.toContain('ghcr.io/mbos/agentsmith-app:dev');
    expect(result.evidence.images.app.host_ref).toBe('localhost:5001/mbos/agentsmith-app:test-tag');
    expect(result.evidence.images.app.k8s_tag_ref).toBe('kind-registry:5000/mbos/agentsmith-app:test-tag');
    expect(result.evidence.images.app.host_digest_ref).toBe(`localhost:5001/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(result.evidence.images.app.k8s_ref).toBe(`kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(result.evidence.images.asbcp.source_ref).toContain('ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.1.0@sha256:');
    expect(result.evidence.images.asbcp.host_ref).toBe('localhost:5001/mbos/agentsmith-sandbox-control-plane:v0.1.0');
    expect(result.evidence.images.asbcp.k8s_tag_ref).toBe('kind-registry:5000/mbos/agentsmith-sandbox-control-plane:v0.1.0');
    expect(result.evidence.images.asbcp.host_digest_ref).toBe(`localhost:5001/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`);
    expect(result.evidence.images.asbcp.k8s_ref).toBe(`kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`);
    expect(result.evidence.images.managed_runner.base_host_ref).toBe('localhost:5001/mbos/agentsmith-managed-runner-base:test-tag');
    expect(result.evidence.images.managed_runner.host_ref).toBe('localhost:5001/mbos/agentsmith-managed-runner:test-tag');
    expect(result.evidence.images.managed_runner.k8s_tag_ref).toBe('kind-registry:5000/mbos/agentsmith-managed-runner:test-tag');
    expect(result.evidence.images.managed_runner.host_digest_ref).toBe(`localhost:5001/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(result.evidence.images.managed_runner.k8s_ref).toBe(`kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(result.evidence.images.afscp.source_ref).toContain('ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.6@sha256:');
    expect(result.evidence.images.afscp.host_ref).toBe('localhost:5001/mbos/agentsmith-fs-control-plane:v1.0.6');
    expect(result.evidence.images.afscp.k8s_tag_ref).toBe('kind-registry:5000/mbos/agentsmith-fs-control-plane:v1.0.6');
    expect(result.evidence.images.afscp.host_digest_ref).toBe(`localhost:5001/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST}`);
    expect(result.evidence.images.afscp.k8s_ref).toBe(`kind-registry:5000/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST}`);
    expect(result.evidence.images.llmup.source_ref).toContain('@sha256:');
    expect(result.evidence.images.llmup.host_ref).toBe('localhost:5001/mbos/llm-universal-proxy:v0.2.27');
    expect(result.evidence.images.llmup.k8s_tag_ref).toBe('kind-registry:5000/mbos/llm-universal-proxy:v0.2.27');
    expect(result.evidence.images.llmup.host_digest_ref).toBe(`localhost:5001/mbos/llm-universal-proxy@${LLMUP_DIGEST}`);
    expect(result.evidence.images.llmup.k8s_ref).toBe(`kind-registry:5000/mbos/llm-universal-proxy@${LLMUP_DIGEST}`);
    expect(result.evidence.images.ingress_nginx_controller.source_ref).toContain('registry.k8s.io/ingress-nginx/controller:v1.15.1@sha256:');
    expect(result.evidence.images.ingress_nginx_controller.host_ref).toBe('localhost:5001/mbos/ingress-nginx-controller:v1.15.1');
    expect(result.evidence.images.ingress_nginx_controller.k8s_tag_ref).toBe('kind-registry:5000/mbos/ingress-nginx-controller:v1.15.1');
    expect(result.evidence.images.ingress_nginx_controller.host_digest_ref).toBe(`localhost:5001/mbos/ingress-nginx-controller@${INGRESS_CONTROLLER_DIGEST}`);
    expect(result.evidence.images.ingress_nginx_controller.k8s_ref).toBe(`kind-registry:5000/mbos/ingress-nginx-controller@${INGRESS_CONTROLLER_DIGEST}`);
    expect(result.evidence.images.ingress_nginx_certgen.source_ref).toContain('registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@sha256:');
    expect(result.evidence.images.ingress_nginx_certgen.host_ref).toBe('localhost:5001/mbos/ingress-nginx-kube-webhook-certgen:v1.6.9');
    expect(result.evidence.images.ingress_nginx_certgen.k8s_tag_ref).toBe('kind-registry:5000/mbos/ingress-nginx-kube-webhook-certgen:v1.6.9');
    expect(result.evidence.images.ingress_nginx_certgen.host_digest_ref).toBe(`localhost:5001/mbos/ingress-nginx-kube-webhook-certgen@${INGRESS_CERTGEN_DIGEST}`);
    expect(result.evidence.images.ingress_nginx_certgen.k8s_ref).toBe(`kind-registry:5000/mbos/ingress-nginx-kube-webhook-certgen@${INGRESS_CERTGEN_DIGEST}`);
    expect(readFileSync(result.evidence.paths.report_path, 'utf8')).toContain('agentsmith.unified-deploy.local-kind-images.evidence/v1');
  });

  it('fails fast when the ASBCP image lock is missing', async () => {
    const root = tempDir('local-kind-images-missing-asbcp-lock-');

    await expect(runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      asbcpImageLockPath: join(root, 'missing-asbcp-image.lock'),
      runner: successfulRunner([]),
    })).rejects.toThrow(/missing-asbcp-image\.lock/u);
  });

  it('rejects a symlinked evidenceDir before writing local-kind image evidence', async () => {
    const root = tempDir('local-kind-images-evidence-');
    const outsideRoot = tempDir('local-kind-images-evidence-outside-');
    const evidenceDir = join(root, 'evidence');
    symlinkSync(outsideRoot, evidenceDir, 'dir');

    await expect(runLocalKindImagesProducer({
      evidenceDir,
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      asbcpImageLockPath: createAsbcpImageLock(root),
      runner: successfulRunner([]),
    })).rejects.toThrow(/evidence.*symlink/i);
  });

  it('anchors release evidence at RELEASE_CAMPAIGN_ROOT even when UNIFIED_DEPLOY_RELEASE_ROOT_DIR is set', async () => {
    const root = tempDir('local-kind-images-campaign-anchor-');
    const outsideRoot = tempDir('local-kind-images-campaign-outside-');
    const campaignRoot = join(root, 'release-ready-safe-id');
    const releaseRoot = join(campaignRoot, 'unified-deploy');
    const originalCampaignRoot = process.env.RELEASE_CAMPAIGN_ROOT;
    const originalUnifiedRoot = process.env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR;
    symlinkSync(outsideRoot, campaignRoot, 'dir');

    try {
      process.env.RELEASE_CAMPAIGN_ROOT = campaignRoot;
      process.env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR = releaseRoot;

      await expect(runLocalKindImagesProducer({
        evidenceDir: join(releaseRoot, 'local-kind-images'),
        outputSiteEnvPath: join(root, 'local-kind-site.env'),
        asbcpImageLockPath: createAsbcpImageLock(root),
        runner: successfulRunner([]),
      })).rejects.toThrow(/campaign|evidence|symlink/i);

      expect(existsSync(join(outsideRoot, 'unified-deploy'))).toBe(false);
    } finally {
      if (originalCampaignRoot === undefined) {
        delete process.env.RELEASE_CAMPAIGN_ROOT;
      } else {
        process.env.RELEASE_CAMPAIGN_ROOT = originalCampaignRoot;
      }
      if (originalUnifiedRoot === undefined) {
        delete process.env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR;
      } else {
        process.env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR = originalUnifiedRoot;
      }
    }
  });

  it('builds app and managed runner images, retags locked ASBCP/AFSCP/llmup images, and pushes local registry refs in order', async () => {
    const root = tempDir('local-kind-images-order-');
    const asbcpImageLockPath = createAsbcpImageLock(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      asbcpImageLockPath,
      tag: 'order-tag',
      runner: successfulRunner(calls),
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('passed');
    expect(commandText).toContain('docker ps');
    expect(commandText).toContain('docker build -t localhost:5001/mbos/agentsmith-app-base:order-tag -f infra/deploy/Dockerfile.agentsmith-app-base');
    expect(commandText).toContain('docker build --build-arg APP_BASE_IMAGE=localhost:5001/mbos/agentsmith-app-base:order-tag -t localhost:5001/mbos/agentsmith-app:order-tag -f infra/deploy/Dockerfile.agentsmith-app');
    expect(commandText).not.toContain('mbos-sandbox-v1');
    expect(commandText).not.toContain('docker build -t localhost:5001/mbos/agentsmith-sandbox-control-plane');
    expect(commandText).not.toContain('docker build -t localhost:5001/mbos/sandbox-manager');
    expect(commandText).toContain('docker build --build-arg RUNNER_BASE_IMAGE=localhost:5001/mbos/agentsmith-managed-runner-base:order-tag -t localhost:5001/mbos/agentsmith-managed-runner:order-tag -f infra/runner/Dockerfile.agent-task-runner');
    expect(commandText).toContain('docker image inspect ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.1.0@sha256:');
    expect(commandText).toContain('docker tag ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.1.0@sha256:');
    expect(commandText).toContain('localhost:5001/mbos/agentsmith-sandbox-control-plane:v0.1.0');
    expect(commandText).toContain('docker image inspect ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.6@sha256:');
    expect(commandText).toContain('docker tag ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.6@sha256:');
    expect(commandText).toContain('localhost:5001/mbos/agentsmith-fs-control-plane:v1.0.6');
    expect(commandText).toContain('docker image inspect ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.27@sha256:');
    expect(commandText).toContain('docker tag ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.27@sha256:');
    expect(commandText).toContain('localhost:5001/mbos/llm-universal-proxy:v0.2.27');
    expect(commandText).toContain('docker image inspect registry.k8s.io/ingress-nginx/controller:v1.15.1@sha256:');
    expect(commandText).toContain('docker image inspect registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@sha256:');
    expect(commandText).toContain('docker tag registry.k8s.io/ingress-nginx/controller:v1.15.1@sha256:');
    expect(commandText).toContain('localhost:5001/mbos/ingress-nginx-controller:v1.15.1');
    expect(commandText).toContain('docker tag registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@sha256:');
    expect(commandText).toContain('localhost:5001/mbos/ingress-nginx-kube-webhook-certgen:v1.6.9');
    expect(commandText).toContain('docker push localhost:5001/mbos/agentsmith-app:order-tag');
    expect(commandText).toContain('docker push localhost:5001/mbos/agentsmith-sandbox-control-plane:v0.1.0');
    expect(commandText).toContain('docker push localhost:5001/mbos/agentsmith-managed-runner:order-tag');
    expect(commandText).toContain('docker push localhost:5001/mbos/agentsmith-fs-control-plane:v1.0.6');
    expect(commandText).toContain('docker push localhost:5001/mbos/llm-universal-proxy:v0.2.27');
    expect(commandText).toContain('docker push localhost:5001/mbos/ingress-nginx-controller:v1.15.1');
    expect(commandText).toContain('docker push localhost:5001/mbos/ingress-nginx-kube-webhook-certgen:v1.6.9');
    expect(commandText).toContain('bash -lc source scripts/lib/kind-cluster-bootstrap.sh');
    expect(commandText).toContain('docker network inspect kind');
    expect(commandText).toContain('docker exec agentsmith-control-plane curl -fsS http://kind-registry:5000/v2/');
  });

  it('fails before generated site env when the locked AFSCP release image is unavailable', async () => {
    const root = tempDir('local-kind-images-afscp-source-unavailable-');
    const asbcpImageLockPath = createAsbcpImageLock(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindImageCommandRunner = async (command, args) => {
      calls.push({ command, args });
      const joined = args.join(' ');
      if (joined.includes('network inspect kind')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }
      if (args.includes('ps')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }
      if (joined.includes('image inspect') && joined.includes('agentsmith-fs-control-plane')) {
        return { exitCode: 1, stdout: '', stderr: 'missing published AFSCP image' };
      }
      if (joined.includes('pull') && joined.includes('agentsmith-fs-control-plane')) {
        return { exitCode: 1, stdout: '', stderr: 'pull failed for published AFSCP image' };
      }

      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };

    const result = await runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      asbcpImageLockPath,
      tag: 'afscp-unavailable',
      runner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'afscp-source-image',
        message: expect.stringContaining('pull failed for published AFSCP image'),
      }),
    ]));
  });

  it('pulls llmup when the locked source image is not already present locally', async () => {
    const root = tempDir('local-kind-images-llmup-pull-');
    const asbcpImageLockPath = createAsbcpImageLock(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindImageCommandRunner = async (command, args) => {
      calls.push({ command, args });
      const joined = args.join(' ');
      if (joined.includes('network inspect kind')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }
      if (joined.includes('buildx imagetools inspect')) {
        const imageRef = args[args.length - 1] ?? '';
        return { exitCode: 0, stdout: `Name: ${imageRef}\nDigest: ${registryDigestForRef(imageRef)}\n`, stderr: '' };
      }
      if (joined.includes('image inspect') && joined.includes('llm-universal-proxy')) {
        return { exitCode: 1, stdout: '', stderr: 'missing source image' };
      }
      if (args.includes('ps')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }

      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };

    const result = await runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      asbcpImageLockPath,
      runner,
    });

    expect(result.status).toBe('passed');
    expect(calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n')).toContain('docker pull --platform linux/amd64 ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.27@sha256:');
  });

  it('passes when docker exec curl sees proxy 503 but CRI/containerd pull succeeds', async () => {
    const root = tempDir('local-kind-images-curl-diagnostic-');
    const asbcpImageLockPath = createAsbcpImageLock(root);
    const outSiteEnvPath = join(root, 'local-kind-site.env');
    const calls: CommandCall[] = [];
    const runner: LocalKindImageCommandRunner = async (_command, args) => {
      calls.push({ command: _command, args });
      const joined = args.join(' ');
      if (joined.includes('network inspect kind')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }
      if (joined.includes('buildx imagetools inspect')) {
        const imageRef = args[args.length - 1] ?? '';
        return { exitCode: 0, stdout: `Name: ${imageRef}\nDigest: ${registryDigestForRef(imageRef)}\n`, stderr: '' };
      }
      if (args.includes('ps')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }
      if (args.includes('exec') && args.includes('agentsmith-control-plane') && joined.includes('curl')) {
        return { exitCode: 22, stdout: '', stderr: 'curl: (22) The requested URL returned error: 503' };
      }

      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };

    const result = await runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: outSiteEnvPath,
      asbcpImageLockPath,
      runner,
    });

    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');
    expect(result.status).toBe('passed');
    expect(commandText).toContain('docker exec agentsmith-control-plane curl -fsS http://kind-registry:5000/v2/');
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/llm-universal-proxy@${LLMUP_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/ingress-nginx-controller@${INGRESS_CONTROLLER_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/ingress-nginx-kube-webhook-certgen@${INGRESS_CERTGEN_DIGEST}`);
    expect(existsSync(outSiteEnvPath)).toBe(true);
  });

  it('polls local-kind registry network availability until a transient failure clears', async () => {
    const registryPoll = testRegistryAvailabilityPoll(50, 5);
    let networkChecks = 0;
    const result = await checkLocalKindImagePreflight({
      renderedYaml: `\
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-api
spec:
  template:
    spec:
      containers:
        - name: api
          image: kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}
`,
      registryAvailabilityPoll: registryPoll.poll,
      runner: async (_command, args) => {
        const joined = args.join(' ');
        if (args.includes('ps')) {
          return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
        }
        if (joined.includes('network inspect kind')) {
          networkChecks += 1;
          return networkChecks === 1
            ? { exitCode: 1, stdout: '', stderr: 'network kind not found' }
            : { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
        }
        if (joined.includes('buildx imagetools inspect')) {
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        }

        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });

    expect(result.status).toBe('passed');
    expect(networkChecks).toBe(2);
    expect(registryPoll.sleeps).toEqual([5]);
  });

  it('reports the last observed registry availability reason when bounded polling times out', async () => {
    const registryPoll = testRegistryAvailabilityPoll();
    const result = await checkLocalKindImagePreflight({
      renderedYaml: `\
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-api
spec:
  template:
    spec:
      containers:
        - name: api
          image: kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}
`,
      registryAvailabilityPoll: registryPoll.poll,
      runner: async (_command, args) => {
        const joined = args.join(' ');
        if (args.includes('ps')) {
          return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
        }
        if (joined.includes('network inspect kind')) {
          return { exitCode: 1, stdout: '', stderr: 'network kind not found' };
        }
        if (joined.includes('buildx imagetools inspect')) {
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        }

        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });
    const serialized = JSON.stringify({
      failures: result.failures,
      diagnostics: result.diagnostics,
    });

    expect(result.status).toBe('failed');
    expect(serialized).toContain('timed out after 2ms');
    expect(serialized).toContain('last observed reason');
    expect(serialized).toContain('network missing');
    expect(registryPoll.sleeps).toEqual([1, 1]);
  });

  it('fails without writing generated site env when CRI/containerd cannot pull local-kind images', async () => {
    const root = tempDir('local-kind-images-cri-pull-');
    const asbcpImageLockPath = createAsbcpImageLock(root);
    const outSiteEnvPath = join(root, 'local-kind-site.env');
    const runner: LocalKindImageCommandRunner = async (_command, args) => {
      const joined = args.join(' ');
      if (joined.includes('network inspect kind')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }
      if (joined.includes('buildx imagetools inspect')) {
        const imageRef = args[args.length - 1] ?? '';
        return { exitCode: 0, stdout: `Name: ${imageRef}\nDigest: ${registryDigestForRef(imageRef)}\n`, stderr: '' };
      }
      if (args.includes('ps')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }
      if (args.includes('exec') && args.includes('agentsmith-control-plane') && joined.includes('crictl pull')) {
        return { exitCode: 1, stdout: '', stderr: 'rpc error: code = Unknown desc = failed to pull: 503 Service Unavailable' };
      }

      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };

    const result = await runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: outSiteEnvPath,
      asbcpImageLockPath,
      registryAvailabilityPoll: testRegistryAvailabilityPoll().poll,
      runner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: expect.stringContaining('registry-pull-path'),
        message: expect.stringContaining('proxy/NO_PROXY mismatch'),
      }),
    ]));
    expect(existsSync(outSiteEnvPath)).toBe(false);
  });

  it('fails without writing generated site env when kind-registry is not attached to the kind network', async () => {
    const root = tempDir('local-kind-images-network-');
    const asbcpImageLockPath = createAsbcpImageLock(root);
    const outSiteEnvPath = join(root, 'local-kind-site.env');
    writeFileSync(outSiteEnvPath, 'WEB_IMAGE=stale-success\n', 'utf8');
    const runner: LocalKindImageCommandRunner = async (_command, args) => {
      const joined = args.join(' ');
      if (joined.includes('network inspect kind')) {
        return { exitCode: 0, stdout: 'agentsmith-control-plane\n', stderr: '' };
      }
      if (joined.includes('buildx imagetools inspect')) {
        const imageRef = args[args.length - 1] ?? '';
        return { exitCode: 0, stdout: `Name: ${imageRef}\nDigest: ${registryDigestForRef(imageRef)}\n`, stderr: '' };
      }
      if (args.includes('ps')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }

      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };

    const result = await runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: outSiteEnvPath,
      asbcpImageLockPath,
      registryAvailabilityPoll: testRegistryAvailabilityPoll().poll,
      runner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'registry-availability:registry-network',
        message: expect.stringContaining('network missing'),
      }),
    ]));
    expect(existsSync(outSiteEnvPath)).toBe(false);
  });

  it('classifies registry preflight failures before local-kind rollout applies manifests', async () => {
    const result = await checkLocalKindImagePreflight({
      renderedYaml: `\
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-api
spec:
  template:
    spec:
      containers:
        - name: api
          image: kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}
`,
      registryAvailabilityPoll: testRegistryAvailabilityPoll().poll,
      runner: async (_command, args) => {
        const joined = args.join(' ');
        if (args.includes('ps')) {
          return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
        }
        if (joined.includes('network inspect kind')) {
          return { exitCode: 1, stdout: '', stderr: 'network kind not found' };
        }
        if (joined.includes('buildx imagetools inspect')) {
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        }
        if (joined.includes('curl')) {
          return { exitCode: 22, stdout: '', stderr: 'HTTP/1.1 503 Service Unavailable via proxy' };
        }
        if (joined.includes('crictl pull')) {
          return { exitCode: 1, stdout: '', stderr: 'rpc error: code = Unknown desc = failed to pull: 503 Service Unavailable' };
        }

        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'image-preflight:registry-network',
        message: expect.stringContaining('kind-registry must be attached to the kind network'),
      }),
      expect.objectContaining({
        path: expect.stringContaining('image-preflight:registry-pull-path'),
        message: expect.stringContaining('proxy/NO_PROXY mismatch'),
      }),
    ]));
  });

  it('rejects mutable local-kind tags before rollout can rely on kubelet image cache behavior', async () => {
    const result = await checkLocalKindImagePreflight({
      renderedYaml: `\
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-api
spec:
  template:
    spec:
      containers:
        - name: api
          image: kind-registry:5000/mbos/agentsmith-app:local-kind-dev
`,
      runner: successfulRunner([]),
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'image-preflight:kind-registry:5000/mbos/agentsmith-app:local-kind-dev',
        message: expect.stringContaining('@sha256'),
      }),
    ]));
  });

  it('checks local-kind preflight Deployment and Job images before rollout applies manifests', async () => {
    const result = await checkLocalKindImagePreflight({
      renderedYaml: `\
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-api
spec:
  template:
    spec:
      containers:
        - name: api
          image: kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: ingress-nginx-admission-create
spec:
  template:
    spec:
      containers:
        - name: create
          image: registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@${INGRESS_CERTGEN_DIGEST}
`,
      runner: successfulRunner([]),
    });

    expect(result.status).toBe('failed');
    expect(result.image_refs).toEqual(expect.arrayContaining([
      `kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`,
      `registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@${INGRESS_CERTGEN_DIGEST}`,
    ]));
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: `image-preflight:registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@${INGRESS_CERTGEN_DIGEST}`,
        message: expect.stringContaining('kind-registry:5000/mbos'),
      }),
    ]));
  });

  it('checks managed runner image refs carried through the support ConfigMap before rollout applies manifests', async () => {
    const result = await checkLocalKindImagePreflight({
      renderedYaml: `\
apiVersion: v1
kind: ConfigMap
metadata:
  name: agentsmith-managed-runner-support
data:
  DEFAULT_MANAGED_RUNNER_IMAGE: ghcr.io/mbos/agentsmith-managed-runner:dev
`,
      runner: successfulRunner([]),
    });

    expect(result.status).toBe('failed');
    expect(result.image_refs).toEqual(expect.arrayContaining([
      'ghcr.io/mbos/agentsmith-managed-runner:dev',
    ]));
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'image-preflight:ghcr.io/mbos/agentsmith-managed-runner:dev',
        message: expect.stringContaining('private ghcr.io/mbos/*:dev image'),
      }),
    ]));
  });

  it('smokes rendered AFSCP bootstrap Job command contracts from the selected image', async () => {
    const calls: CommandCall[] = [];
    const result = await checkLocalKindImagePreflight({
      renderedYaml: afscpBootstrapJobsYaml(),
      runner: afscpCommandContractRunner(calls),
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('passed');
    expect(commandText).toContain(`docker run --rm --network=none --entrypoint /usr/local/bin/afscp-migrate localhost:5001/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST} --apply --check --timeout=60s`);
    expect(commandText).toContain(`docker run --rm --network=none --entrypoint /usr/local/bin/afscp-volume-bootstrap localhost:5001/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST} --ensure --check --timeout=60s`);
    expect(result.diagnostics.join('\n')).toContain('AFSCP command contract smoke');
    expect(result.diagnostics.join('\n')).toContain('not full bootstrap readiness');
  });

  it('smokes the full rendered AFSCP Job command vector without dropping command argv', async () => {
    const calls: CommandCall[] = [];
    const result = await checkLocalKindImagePreflight({
      renderedYaml: afscpBootstrapJobsYaml({
        schemaCommand: ['/usr/local/bin/afscp-migrate', '--apply'],
        schemaArgs: ['--check', '--timeout=60s'],
        volumeCommand: ['/usr/local/bin/afscp-volume-bootstrap', '--ensure'],
        volumeArgs: ['--check', '--timeout=60s'],
      }),
      runner: afscpCommandContractRunner(calls),
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('passed');
    expect(commandText).toContain(`docker run --rm --network=none --entrypoint /usr/local/bin/afscp-migrate localhost:5001/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST} --apply --check --timeout=60s`);
    expect(commandText).toContain(`docker run --rm --network=none --entrypoint /usr/local/bin/afscp-volume-bootstrap localhost:5001/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST} --ensure --check --timeout=60s`);
  });

  it('does not emit passed diagnostics when an AFSCP command smoke fails', async () => {
    const result = await checkLocalKindImagePreflight({
      renderedYaml: afscpBootstrapJobsYaml(),
      runner: async (_command, args) => {
        const joined = args.join(' ');
        if (args.includes('ps')) {
          return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
        }
        if (joined.includes('network inspect kind')) {
          return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
        }
        if (joined.includes('buildx imagetools inspect')) {
          const imageRef = args[args.length - 1] ?? '';
          return { exitCode: 0, stdout: `Name: ${imageRef}\nDigest: ${registryDigestForRef(imageRef)}\n`, stderr: '' };
        }
        if (args.includes('exec') && args.includes('agentsmith-control-plane')) {
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        }
        if (args[0] === 'run') {
          return { exitCode: 127, stdout: '', stderr: 'unexpected argument contract failure' };
        }

        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });
    const diagnostics = result.diagnostics.join('\n');

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'afscp-command-contract:Job/afscp-schema-bootstrap',
        message: expect.stringContaining('argument contract'),
      }),
    ]));
    expect(diagnostics).toContain('unexpected argument contract failure');
    expect(diagnostics).not.toContain('smoke passed');
  });

  it('fails the AFSCP command contract when rendered schema bootstrap lacks an action flag', async () => {
    const result = await checkLocalKindImagePreflight({
      renderedYaml: afscpBootstrapJobsYaml({ schemaArgs: ['--timeout=60s'] }),
      runner: afscpCommandContractRunner([]),
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'afscp-command-contract:Job/afscp-schema-bootstrap',
        message: expect.stringContaining('--apply or --check'),
      }),
    ]));
  });

  it('fails the AFSCP command contract when rendered volume bootstrap uses the schema --apply flag', async () => {
    const calls: CommandCall[] = [];
    const result = await checkLocalKindImagePreflight({
      renderedYaml: afscpBootstrapJobsYaml({ volumeArgs: ['--apply', '--check', '--timeout=60s'] }),
      runner: afscpCommandContractRunner(calls),
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('failed');
    expect(commandText).toContain(`docker run --rm --network=none --entrypoint /usr/local/bin/afscp-volume-bootstrap localhost:5001/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST} --apply --check --timeout=60s`);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'afscp-command-contract:Job/afscp-volume-bootstrap',
        message: expect.stringContaining('--ensure'),
      }),
    ]));
  });

  it('redacts secret-like rendered AFSCP args from smoke failure diagnostics', async () => {
    const secret = 'super_secret_token_123';
    const result = await checkLocalKindImagePreflight({
      renderedYaml: afscpBootstrapJobsYaml({
        schemaArgs: ['--apply', `--admin-token=${secret}`, '--check', '--timeout=60s'],
      }),
      runner: async (_command, args) => {
        const joined = args.join(' ');
        if (args.includes('ps')) {
          return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
        }
        if (joined.includes('network inspect kind')) {
          return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
        }
        if (joined.includes('buildx imagetools inspect')) {
          const imageRef = args[args.length - 1] ?? '';
          return { exitCode: 0, stdout: `Name: ${imageRef}\nDigest: ${registryDigestForRef(imageRef)}\n`, stderr: '' };
        }
        if (args.includes('exec') && args.includes('agentsmith-control-plane')) {
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        }
        if (args[0] === 'run') {
          return {
            exitCode: 127,
            stdout: '',
            stderr: `unexpected rendered arg --admin-token=${secret}`,
          };
        }

        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });
    const serialized = JSON.stringify({
      failures: result.failures,
      diagnostics: result.diagnostics,
    });

    expect(result.status).toBe('failed');
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain('[REDACTED]');
  });

  it('redacts secret-like values from docker diagnostics in evidence', async () => {
    const root = tempDir('local-kind-images-redaction-');
    const asbcpImageLockPath = createAsbcpImageLock(root);
    const runner: LocalKindImageCommandRunner = async (_command, args) => {
      if (args.includes('build') && args.includes('-f') && args.includes('infra/deploy/Dockerfile.agentsmith-app-base')) {
        return {
          exitCode: 1,
          stdout: 'TOKEN=super_secret_token_123',
          stderr: 'build arg SECRET=super_secret_token_123 failed',
        };
      }
      if (args.includes('ps')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }

      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };

    const result = await runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      asbcpImageLockPath,
      runner,
    });
    const report = readFileSync(result.evidence.paths.report_path, 'utf8');

    expect(result.status).toBe('failed');
    expect(report).not.toContain('super_secret_token_123');
    expect(report).toContain('[REDACTED]');
  });
});
