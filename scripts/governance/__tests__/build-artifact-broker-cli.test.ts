import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateBuildManifestAggregate } from '../build-artifact-broker';
import { runBuildArtifactBrokerCli } from '../build-artifact-broker-cli';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const RUN_ID = 'build-artifact-broker-cli-test';
const APP_BASE_DIGEST = `sha256:${'a'.repeat(64)}`;
const APP_MC_DIGEST = `sha256:${'f'.repeat(64)}`;
const APP_IMAGE_DIGEST = `sha256:${'d'.repeat(64)}`;
const LLMUP_DIGEST = 'sha256:4996453b1353868ca9e99c584719c9905e1ebbbd6d2ff585378bc0050989583b';
const LLMUP_SOURCE_IMAGE = `ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.27@${LLMUP_DIGEST}`;

interface BrokerFixture {
  tempRoot: string;
  releaseRoot: string;
  appSourceDir: string;
  digestProbePath: string;
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function writeExecutable(filePath: string, content: string): void {
  writeFile(filePath, content);
  chmodSync(filePath, 0o755);
}

function stageBrokerFixture(versionContent?: string): BrokerFixture {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'build-artifact-broker-cli-'));
  const releaseRoot = path.join(tempRoot, 'release');
  const appSourceDir = path.join(tempRoot, 'sources', 'agentsmith');
  const digestProbePath = path.join(tempRoot, 'bin', 'digest-probe');

  writeFile(
    path.join(releaseRoot, 'VERSION'),
    versionContent
      ?? [
        'release_id=release-20260427',
        'agentsmith_app_image=localhost:5001/mbos/agentsmith-app:release-20260427',
        'llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:release-20260427',
        '',
      ].join('\n'),
  );

  writeFile(path.join(appSourceDir, 'package.json'), '{"name":"agentsmith"}\n');
  writeFile(path.join(appSourceDir, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFile(path.join(appSourceDir, 'next.config.ts'), 'export default {};\n');
  writeFile(path.join(appSourceDir, 'src', 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFile(path.join(appSourceDir, 'messages', 'en-US.json'), '{"hello":"Hello"}\n');
  writeFile(path.join(appSourceDir, 'infra', 'deploy', 'Dockerfile.agentsmith-app'), 'FROM app-base\n');
  writeFile(path.join(appSourceDir, '.git', 'config'), 'excluded git metadata\n');
  writeFile(path.join(appSourceDir, 'node_modules', 'pkg', 'index.js'), 'excluded node module\n');
  writeFile(path.join(appSourceDir, '.next', 'server', 'app.js'), 'excluded next output\n');
  writeFile(path.join(appSourceDir, 'target', 'debug', 'app'), 'excluded rust output\n');
  writeFile(path.join(appSourceDir, 'dist', 'bundle.js'), 'excluded dist output\n');
  writeFile(path.join(appSourceDir, 'artifacts', 'build.log'), 'excluded artifact\n');
  writeFile(path.join(appSourceDir, 'packages', 'api-entry-node', 'node_modules', '.vite', 'vitest', 'results.json'), '{}\n');
  writeFile(
    path.join(appSourceDir, 'packages', 'api-entry-node', 'artifacts', 'system-workspaces.json'),
    '{"workspaces":[]}\n',
  );
  writeFile(path.join(appSourceDir, 'packages', 'api-entry-node', 'dist', 'runtime.js'), 'export const runtime = true;\n');
  writeFile(path.join(appSourceDir, 'packages', 'api-entry-node', 'target', 'debug', 'cache.bin'), 'nested target\n');

  writeExecutable(
    digestProbePath,
    `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  *agentsmith-app*) printf '%s\\n' '${APP_IMAGE_DIGEST}' ;;
  *) exit 1 ;;
esac
`,
  );

  return {
    tempRoot,
    releaseRoot,
    appSourceDir,
    digestProbePath,
  };
}

function runBroker(
  fixture: BrokerFixture,
  extraArgs: readonly string[] = [],
  releaseId = 'release-20260427',
): number {
  const exitCode = runBuildArtifactBrokerCli({
    argv: [
      '--release-root',
      fixture.releaseRoot,
      '--release-id',
      releaseId,
      '--app-source-dir',
      fixture.appSourceDir,
      '--app-base-image',
      `docker.io/library/node:24-bookworm@${APP_BASE_DIGEST}`,
      '--app-base-image',
      `docker.io/minio/mc:RELEASE.2026-04-27T12-00-00Z@${APP_MC_DIGEST}`,
      ...extraArgs,
    ],
    env: {
      ...process.env,
      BUILD_ARTIFACT_BROKER_IMAGE_DIGEST_COMMAND: fixture.digestProbePath,
      BUILD_ARTIFACT_BROKER_GENERATED_AT: GENERATED_AT,
      BUILD_ARTIFACT_BROKER_RUN_ID: RUN_ID,
    },
    stdout: () => undefined,
    stderr: (message) => {
      if (process.env.DEBUG_BUILD_ARTIFACT_BROKER_CLI_TEST === '1') {
        console.error(message);
      }
    },
  });
  const reportPath = path.join(fixture.releaseRoot, 'build-artifact-broker-report.json');
  if (process.env.DEBUG_BUILD_ARTIFACT_BROKER_CLI_TEST === '1' && exitCode !== 0 && existsSync(reportPath)) {
    console.error(readFileSync(reportPath, 'utf8'));
  }
  return exitCode;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function findForbiddenEvidenceTruthField(value: unknown): string | null {
  const forbiddenFields = new Set([
    'verdict',
    'claim_id',
    'reusable',
    'passed',
    'failed',
    'status',
    'result_status',
    'failure_class',
    'evidence_claim',
    'claim_reuse',
    'cache_hit',
  ]);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenEvidenceTruthField(entry);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (forbiddenFields.has(key)) {
      return key;
    }
    const found = findForbiddenEvidenceTruthField(nestedValue);
    if (found) {
      return found;
    }
  }

  return null;
}

describe('build artifact broker CLI adapter', () => {
  it('does not require llmup source inputs and emits only the app target', () => {
    const fixture = stageBrokerFixture([
      'release_id=test-release',
      'agentsmith_app_image=localhost:5001/mbos/agentsmith-app:test-release',
      'llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:v0.2.27',
      'llmup_version=v0.2.27',
      `llmup_source_image=${LLMUP_SOURCE_IMAGE}`,
      `llmup_source_image_digest=${LLMUP_DIGEST}`,
      '',
    ].join('\n'));

    try {
      expect(existsSync(path.join(fixture.tempRoot, 'sources', 'llm-universal-proxy'))).toBe(false);

      expect(runBroker(fixture, ['--artifact-kind', 'prebuild-plan'], 'test-release')).toBe(0);

      const plan = readJson(path.join(fixture.releaseRoot, 'build-artifact-broker-plan.json')) as {
        targets: Array<{ target: string }>;
      };
      expect(plan.targets.map((target) => target.target)).toEqual(['app']);

      expect(runBroker(fixture, [], 'test-release')).toBe(0);

      const manifest = readJson(path.join(fixture.releaseRoot, 'build-manifest.json')) as {
        targets: Array<{ target: string }>;
      };
      expect(manifest.targets.map((target) => target.target)).toEqual(['app']);
      expect(validateBuildManifestAggregate(manifest).ok).toBe(true);
    } finally {
      rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  it('writes a prebuild plan with normalized release aliases before local image digests exist', () => {
    const fixture = stageBrokerFixture([
      'release_id=test-release',
      'agentsmith_app_image=localhost:5001/mbos/agentsmith-app:test-release',
      'llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:test-release',
      '',
    ].join('\n'));

    try {
      expect(runBroker(fixture, ['--artifact-kind', 'prebuild-plan'], 'test-release')).toBe(0);

      const planPath = path.join(fixture.releaseRoot, 'build-artifact-broker-plan.json');
      const manifestPath = path.join(fixture.releaseRoot, 'build-manifest.json');
      const reportPath = path.join(fixture.releaseRoot, 'build-artifact-broker-report.json');
      const plan = readJson(planPath) as {
        plan_kind: string;
        release_id: string;
        targets: Array<{
          target: string;
          content_key: string;
          content_ref: string;
          release_alias_ref: string;
          image_digest?: string;
        }>;
      };

      expect(existsSync(reportPath)).toBe(false);
      expect(existsSync(manifestPath)).toBe(false);
      expect(plan).toMatchObject({
        plan_kind: 'build_prebuild_plan',
        release_id: 'test-release',
      });
      expect(plan.targets).toHaveLength(1);

      const appPlanTarget = plan.targets.find((target) => target.target === 'app');

      expect(appPlanTarget?.content_ref).toMatch(/^localhost:5001\/mbos\/agentsmith-app:ck-[a-f0-9]{32}$/u);
      expect(appPlanTarget?.release_alias_ref).toBe('localhost:5001/mbos/agentsmith-app:release-test-release');
      expect(appPlanTarget?.content_key).toMatch(/^ck-[a-f0-9]{32}$/u);
      expect(appPlanTarget).not.toHaveProperty('image_digest');

      expect(runBroker(fixture, [], 'test-release')).toBe(0);

      const manifest = readJson(manifestPath) as {
        targets: Array<{ target: string; content_ref: string; release_alias_ref: string }>;
      };
      const manifestRefsByTarget = Object.fromEntries(
        manifest.targets.map((target) => [target.target, {
          content_ref: target.content_ref,
          release_alias_ref: target.release_alias_ref,
        }]),
      );

      expect(manifestRefsByTarget.app).toEqual({
        content_ref: appPlanTarget?.content_ref,
        release_alias_ref: appPlanTarget?.release_alias_ref,
      });
      expect(manifestRefsByTarget.llmup).toBeUndefined();
    } finally {
      rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  it('scans app sources with stable exclusions and writes an aggregate manifest', () => {
    const fixture = stageBrokerFixture();

    try {
      expect(runBroker(fixture)).toBe(0);

      const manifestPath = path.join(fixture.releaseRoot, 'build-manifest.json');
      const reportPath = path.join(fixture.releaseRoot, 'build-artifact-broker-report.json');
      const manifest = readJson(manifestPath);

      expect(existsSync(reportPath)).toBe(false);
      expect(validateBuildManifestAggregate(manifest).ok).toBe(true);
      expect(manifest).toMatchObject({
        release_id: 'release-20260427',
        run_id: RUN_ID,
        mode: 'build',
      });
      expect((manifest as { targets: Array<{ target: string }> }).targets.map((target) => target.target)).toEqual([
        'app',
      ]);

      const firstDigests = Object.fromEntries(
        (manifest as { targets: Array<{ target: string; input_digest: string }> }).targets.map(
          (target) => [target.target, target.input_digest],
        ),
      );

      writeFile(path.join(fixture.appSourceDir, 'node_modules', 'pkg', 'index.js'), 'changed excluded module\n');
      writeFile(path.join(fixture.appSourceDir, '.next', 'server', 'app.js'), 'changed excluded next output\n');
      writeFile(path.join(fixture.appSourceDir, 'target', 'debug', 'app'), 'changed excluded root target\n');
      writeFile(path.join(fixture.appSourceDir, 'dist', 'bundle.js'), 'changed excluded dist output\n');
      writeFile(path.join(fixture.appSourceDir, 'artifacts', 'build.log'), 'changed excluded artifact\n');
      expect(runBroker(fixture)).toBe(0);

      const secondManifest = readJson(manifestPath) as { targets: Array<{ target: string; input_digest: string }> };
      const secondDigests = Object.fromEntries(
        secondManifest.targets.map((target) => [target.target, target.input_digest]),
      );
      expect(secondDigests).toEqual(firstDigests);

      writeFile(
        path.join(fixture.appSourceDir, 'packages', 'api-entry-node', 'artifacts', 'system-workspaces.json'),
        '{"workspaces":["changed"]}\n',
      );
      writeFile(
        path.join(fixture.appSourceDir, 'packages', 'api-entry-node', 'dist', 'runtime.js'),
        'export const runtime = "changed";\n',
      );
      expect(runBroker(fixture)).toBe(0);

      const thirdManifest = readJson(manifestPath) as { targets: Array<{ target: string; input_digest: string }> };
      const thirdDigests = Object.fromEntries(thirdManifest.targets.map((target) => [target.target, target.input_digest]));
      expect(thirdDigests.app).not.toBe(secondDigests.app);

      writeFile(
        path.join(fixture.appSourceDir, 'packages', 'api-entry-node', 'node_modules', '.vite', 'vitest', 'results.json'),
        '{"changed":true}\n',
      );
      writeFile(
        path.join(fixture.appSourceDir, 'packages', 'api-entry-node', 'target', 'debug', 'cache.bin'),
        'changed nested target\n',
      );
      expect(runBroker(fixture)).toBe(0);

      const fourthManifest = readJson(manifestPath) as { targets: Array<{ target: string; input_digest: string }> };
      const fourthDigests = Object.fromEntries(fourthManifest.targets.map((target) => [target.target, target.input_digest]));
      expect(fourthDigests.app).not.toBe(thirdDigests.app);
    } finally {
      rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  it('writes per-target manifest decisions from CLI input', () => {
    const fixture = stageBrokerFixture();

    try {
      expect(runBroker(fixture, ['--target-decision', 'app=reused'])).toBe(0);

      const manifest = readJson(path.join(fixture.releaseRoot, 'build-manifest.json')) as {
        targets: Array<{ target: string; decision: string }>;
      };
      const decisionsByTarget = Object.fromEntries(
        manifest.targets.map((target) => [target.target, target.decision]),
      );

      expect(validateBuildManifestAggregate(manifest).ok).toBe(true);
      expect(decisionsByTarget).toMatchObject({
        app: 'reused',
      });
      expect(decisionsByTarget.llmup).toBeUndefined();
    } finally {
      rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed on invalid per-target manifest decision input', () => {
    const invalidTargetFixture = stageBrokerFixture();
    const invalidDecisionFixture = stageBrokerFixture();
    const deprecatedTargetFixture = stageBrokerFixture();

    try {
      expect(runBroker(invalidTargetFixture, ['--target-decision', 'worker=reused'])).toBe(1);
      expect(existsSync(path.join(invalidTargetFixture.releaseRoot, 'build-manifest.json'))).toBe(false);

      expect(runBroker(invalidDecisionFixture, ['--target-decision', 'app=reusable'])).toBe(1);
      expect(existsSync(path.join(invalidDecisionFixture.releaseRoot, 'build-manifest.json'))).toBe(false);

      expect(runBroker(deprecatedTargetFixture, ['--target-decision', 'llmup=skipped'])).toBe(1);
      expect(existsSync(path.join(deprecatedTargetFixture.releaseRoot, 'build-manifest.json'))).toBe(false);
    } finally {
      rmSync(invalidTargetFixture.tempRoot, { recursive: true, force: true });
      rmSync(invalidDecisionFixture.tempRoot, { recursive: true, force: true });
      rmSync(deprecatedTargetFixture.tempRoot, { recursive: true, force: true });
    }
  });

  it('writes a structured diagnostic report instead of an invalid manifest when an image digest is missing', () => {
    const fixture = stageBrokerFixture();

    try {
      writeExecutable(
        fixture.digestProbePath,
`#!/usr/bin/env bash
set -euo pipefail
exit 1
`,
      );

      expect(runBroker(fixture)).toBe(1);

      const manifestPath = path.join(fixture.releaseRoot, 'build-manifest.json');
      const reportPath = path.join(fixture.releaseRoot, 'build-artifact-broker-report.json');
      const report = readJson(reportPath);

      expect(existsSync(manifestPath)).toBe(false);
      expect(report).toMatchObject({
        report_kind: 'build_artifact_broker_diagnostic',
        release_id: 'release-20260427',
      });
      expect(JSON.stringify(report)).toContain('missing_image_digest');
      expect(JSON.stringify(report)).toContain('app');
      expect(findForbiddenEvidenceTruthField(report)).toBeNull();
    } finally {
      rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects deprecated llmup source and base image CLI arguments', () => {
    const fixture = stageBrokerFixture();

    try {
      expect(
        runBroker(fixture, [
          '--llmup-source-dir',
          path.join(fixture.tempRoot, 'sources', 'llm-universal-proxy'),
        ]),
      ).toBe(1);
      expect(
        runBroker(fixture, [
          '--llmup-base-image',
          `docker.io/library/rust:1.88-bookworm@${APP_BASE_DIGEST}`,
        ]),
      ).toBe(1);
      expect(existsSync(path.join(fixture.releaseRoot, 'build-manifest.json'))).toBe(false);
    } finally {
      rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when VERSION.release_id is missing or mismatches RELEASE_ID', () => {
    const mismatchFixture = stageBrokerFixture('release_id=release-from-version\n');
    const missingFixture = stageBrokerFixture('agentsmith_app_image=agentsmith-app:release-20260427\n');

    try {
      expect(runBroker(mismatchFixture)).toBe(42);
      expect(existsSync(path.join(mismatchFixture.releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(JSON.stringify(readJson(path.join(mismatchFixture.releaseRoot, 'build-artifact-broker-report.json')))).toContain(
        'release_id_truth_failure',
      );

      expect(runBroker(missingFixture)).toBe(42);
      expect(existsSync(path.join(missingFixture.releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(JSON.stringify(readJson(path.join(missingFixture.releaseRoot, 'build-artifact-broker-report.json')))).toContain(
        'VERSION.release_id is required',
      );
    } finally {
      rmSync(mismatchFixture.tempRoot, { recursive: true, force: true });
      rmSync(missingFixture.tempRoot, { recursive: true, force: true });
    }
  });
});
