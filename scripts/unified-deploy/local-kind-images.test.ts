import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkLocalKindImagePreflight,
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
const SANDBOX_DIGEST = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
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

function createSandboxSource(root: string): string {
  const source = join(root, 'mbos-sandbox-v1', 'manager-service');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'Dockerfile'), 'FROM scratch\n', 'utf8');
  return source;
}

function createAfscpSource(root: string): string {
  const source = join(root, 'agentsmith-fs-control-plane');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'Dockerfile'), 'FROM scratch\n', 'utf8');
  return source;
}

function registryDigestForRef(ref: string): string {
  if (ref.includes('/agentsmith-app:')) {
    return APP_DIGEST;
  }
  if (ref.includes('/sandbox-manager:')) {
    return SANDBOX_DIGEST;
  }
  if (ref.includes('/llm-universal-proxy:')) {
    return LLMUP_DIGEST;
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
  if (ref.includes('/agentsmith-fs-control-plane:')) {
    return AFSCP_DIGEST;
  }

  return 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
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

  it('generates a local-kind site env with immutable K8s digest refs and records host push refs', async () => {
    const root = tempDir('local-kind-images-');
    const sandboxSourceDir = createSandboxSource(root);
    const afscpSourceDir = createAfscpSource(root);
    const evidenceDir = join(root, 'evidence');
    const calls: CommandCall[] = [];

    const result = await runLocalKindImagesProducer({
      evidenceDir,
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      sandboxSourceDir,
      afscpSourceDir,
      tag: 'test-tag',
      runner: successfulRunner(calls),
    });
    const siteEnv = readFileSync(result.evidence.generated_site_env_path, 'utf8');

    expect(result.status).toBe('passed');
    expect(siteEnv).toContain(`WEB_IMAGE=kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(siteEnv).toContain(`API_IMAGE=kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(siteEnv).toContain(`LLMUP_IMAGE=kind-registry:5000/mbos/llm-universal-proxy@${LLMUP_DIGEST}`);
    expect(siteEnv).toContain(`AFSCP_IMAGE=kind-registry:5000/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST}`);
    expect(siteEnv).toContain(`SANDBOX_MANAGER_IMAGE=kind-registry:5000/mbos/sandbox-manager@${SANDBOX_DIGEST}`);
    expect(siteEnv).toContain(`MANAGED_RUNNER_IMAGE=kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(siteEnv).toContain(`INGRESS_NGINX_CONTROLLER_IMAGE=kind-registry:5000/mbos/ingress-nginx-controller@${INGRESS_CONTROLLER_DIGEST}`);
    expect(siteEnv).toContain(`INGRESS_NGINX_CERTGEN_IMAGE=kind-registry:5000/mbos/ingress-nginx-kube-webhook-certgen@${INGRESS_CERTGEN_DIGEST}`);
    expect(siteEnv).not.toContain('kind-registry:5000/mbos/agentsmith-app:test-tag');
    expect(siteEnv).not.toContain('ghcr.io/mbos/agentsmith-app:dev');
    expect(result.evidence.images.app.host_ref).toBe('localhost:5001/mbos/agentsmith-app:test-tag');
    expect(result.evidence.images.app.k8s_tag_ref).toBe('kind-registry:5000/mbos/agentsmith-app:test-tag');
    expect(result.evidence.images.app.host_digest_ref).toBe(`localhost:5001/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(result.evidence.images.app.k8s_ref).toBe(`kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(result.evidence.images.sandbox_manager.host_ref).toBe('localhost:5001/mbos/sandbox-manager:test-tag');
    expect(result.evidence.images.sandbox_manager.k8s_tag_ref).toBe('kind-registry:5000/mbos/sandbox-manager:test-tag');
    expect(result.evidence.images.sandbox_manager.host_digest_ref).toBe(`localhost:5001/mbos/sandbox-manager@${SANDBOX_DIGEST}`);
    expect(result.evidence.images.sandbox_manager.k8s_ref).toBe(`kind-registry:5000/mbos/sandbox-manager@${SANDBOX_DIGEST}`);
    expect(result.evidence.images.managed_runner.base_host_ref).toBe('localhost:5001/mbos/agentsmith-managed-runner-base:test-tag');
    expect(result.evidence.images.managed_runner.host_ref).toBe('localhost:5001/mbos/agentsmith-managed-runner:test-tag');
    expect(result.evidence.images.managed_runner.k8s_tag_ref).toBe('kind-registry:5000/mbos/agentsmith-managed-runner:test-tag');
    expect(result.evidence.images.managed_runner.host_digest_ref).toBe(`localhost:5001/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(result.evidence.images.managed_runner.k8s_ref).toBe(`kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(result.evidence.images.afscp.host_ref).toBe('localhost:5001/mbos/agentsmith-fs-control-plane:test-tag');
    expect(result.evidence.images.afscp.k8s_tag_ref).toBe('kind-registry:5000/mbos/agentsmith-fs-control-plane:test-tag');
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

  it('fails fast when sandbox manager source is missing', async () => {
    const root = tempDir('local-kind-images-missing-sandbox-');
    const calls: CommandCall[] = [];

    const result = await runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      sandboxSourceDir: join(root, 'missing', 'manager-service'),
      runner: successfulRunner(calls),
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'sandbox-source',
        message: expect.stringContaining('SANDBOX_SOURCE_DIR'),
      }),
    ]));
    expect(calls.some((call) => call.args.includes('build'))).toBe(false);
  });

  it('rejects a symlinked evidenceDir before writing local-kind image evidence', async () => {
    const root = tempDir('local-kind-images-evidence-');
    const outsideRoot = tempDir('local-kind-images-evidence-outside-');
    const evidenceDir = join(root, 'evidence');
    symlinkSync(outsideRoot, evidenceDir, 'dir');

    await expect(runLocalKindImagesProducer({
      evidenceDir,
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      sandboxSourceDir: join(root, 'missing', 'manager-service'),
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
        sandboxSourceDir: join(root, 'missing', 'manager-service'),
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

  it('builds app, sandbox, managed runner images, retags locked llmup, and pushes local registry refs in order', async () => {
    const root = tempDir('local-kind-images-order-');
    const sandboxSourceDir = createSandboxSource(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindImagesProducer({
      evidenceDir: join(root, 'evidence'),
      outputSiteEnvPath: join(root, 'local-kind-site.env'),
      sandboxSourceDir,
      tag: 'order-tag',
      runner: successfulRunner(calls),
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('passed');
    expect(commandText).toContain('docker ps');
    expect(commandText).toContain('docker build -t localhost:5001/mbos/agentsmith-app-base:order-tag -f infra/deploy/Dockerfile.agentsmith-app-base');
    expect(commandText).toContain('docker build --build-arg APP_BASE_IMAGE=localhost:5001/mbos/agentsmith-app-base:order-tag -t localhost:5001/mbos/agentsmith-app:order-tag -f infra/deploy/Dockerfile.agentsmith-app');
    expect(commandText).toContain(`docker build -t localhost:5001/mbos/sandbox-manager:order-tag -f ${join(sandboxSourceDir, 'Dockerfile')}`);
    expect(commandText).toContain('docker build --build-arg RUNNER_BASE_IMAGE=localhost:5001/mbos/agentsmith-managed-runner-base:order-tag -t localhost:5001/mbos/agentsmith-managed-runner:order-tag -f infra/runner/Dockerfile.agent-task-runner');
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
    expect(commandText).toContain('docker push localhost:5001/mbos/sandbox-manager:order-tag');
    expect(commandText).toContain('docker push localhost:5001/mbos/agentsmith-managed-runner:order-tag');
    expect(commandText).toContain('docker push localhost:5001/mbos/llm-universal-proxy:v0.2.27');
    expect(commandText).toContain('docker push localhost:5001/mbos/ingress-nginx-controller:v1.15.1');
    expect(commandText).toContain('docker push localhost:5001/mbos/ingress-nginx-kube-webhook-certgen:v1.6.9');
    expect(commandText).toContain('bash -lc source scripts/lib/kind-cluster-bootstrap.sh');
    expect(commandText).toContain('docker network inspect kind');
    expect(commandText).toContain('docker exec agentsmith-control-plane curl -fsS http://kind-registry:5000/v2/');
  });

  it('pulls llmup when the locked source image is not already present locally', async () => {
    const root = tempDir('local-kind-images-llmup-pull-');
    const sandboxSourceDir = createSandboxSource(root);
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
      sandboxSourceDir,
      runner,
    });

    expect(result.status).toBe('passed');
    expect(calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n')).toContain('docker pull --platform linux/amd64 ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.27@sha256:');
  });

  it('passes when docker exec curl sees proxy 503 but CRI/containerd pull succeeds', async () => {
    const root = tempDir('local-kind-images-curl-diagnostic-');
    const sandboxSourceDir = createSandboxSource(root);
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
      sandboxSourceDir,
      runner,
    });

    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');
    expect(result.status).toBe('passed');
    expect(commandText).toContain('docker exec agentsmith-control-plane curl -fsS http://kind-registry:5000/v2/');
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/sandbox-manager@${SANDBOX_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/llm-universal-proxy@${LLMUP_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/ingress-nginx-controller@${INGRESS_CONTROLLER_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/ingress-nginx-kube-webhook-certgen@${INGRESS_CERTGEN_DIGEST}`);
    expect(existsSync(outSiteEnvPath)).toBe(true);
  });

  it('fails without writing generated site env when CRI/containerd cannot pull local-kind images', async () => {
    const root = tempDir('local-kind-images-cri-pull-');
    const sandboxSourceDir = createSandboxSource(root);
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
      sandboxSourceDir,
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
    const sandboxSourceDir = createSandboxSource(root);
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
      sandboxSourceDir,
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

  it('redacts secret-like values from docker diagnostics in evidence', async () => {
    const root = tempDir('local-kind-images-redaction-');
    const sandboxSourceDir = createSandboxSource(root);
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
      sandboxSourceDir,
      runner,
    });
    const report = readFileSync(result.evidence.paths.report_path, 'utf8');

    expect(result.status).toBe('failed');
    expect(report).not.toContain('super_secret_token_123');
    expect(report).toContain('[REDACTED]');
  });
});
