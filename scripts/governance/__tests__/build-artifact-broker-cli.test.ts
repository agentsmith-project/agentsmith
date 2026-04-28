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
const LLMUP_RUST_BASE_DIGEST = `sha256:${'b'.repeat(64)}`;
const LLMUP_RUNTIME_BASE_DIGEST = `sha256:${'c'.repeat(64)}`;
const APP_IMAGE_DIGEST = `sha256:${'d'.repeat(64)}`;
const LLMUP_IMAGE_DIGEST = `sha256:${'e'.repeat(64)}`;

interface BrokerFixture {
  tempRoot: string;
  releaseRoot: string;
  appSourceDir: string;
  llmupSourceDir: string;
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
  const llmupSourceDir = path.join(tempRoot, 'sources', 'llm-universal-proxy');
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

  writeFile(path.join(llmupSourceDir, 'Cargo.toml'), '[package]\nname = "llm-universal-proxy"\n');
  writeFile(path.join(llmupSourceDir, 'Cargo.lock'), '# lock\n');
  writeFile(path.join(llmupSourceDir, 'Dockerfile'), 'FROM rust\nCOPY src ./src\n');
  writeFile(path.join(llmupSourceDir, 'src', 'main.rs'), 'fn main() {}\n');
  writeFile(path.join(llmupSourceDir, 'target', 'debug', 'llmup'), 'excluded target output\n');
  writeFile(path.join(llmupSourceDir, 'dist', 'bundle'), 'excluded dist output\n');
  writeFile(path.join(llmupSourceDir, 'artifacts', 'trace.json'), 'excluded artifact\n');

  writeExecutable(
    digestProbePath,
    `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  *agentsmith-app*) printf '%s\\n' '${APP_IMAGE_DIGEST}' ;;
  *llm-universal-proxy*) printf '%s\\n' '${LLMUP_IMAGE_DIGEST}' ;;
  *) exit 1 ;;
esac
`,
  );

  return {
    tempRoot,
    releaseRoot,
    appSourceDir,
    llmupSourceDir,
    digestProbePath,
  };
}

function runBroker(fixture: BrokerFixture, extraArgs: readonly string[] = []): number {
  return runBuildArtifactBrokerCli({
    argv: [
      '--release-root',
      fixture.releaseRoot,
      '--release-id',
      'release-20260427',
      '--app-source-dir',
      fixture.appSourceDir,
      '--llmup-source-dir',
      fixture.llmupSourceDir,
      '--app-base-image',
      `docker.io/library/node:24-bookworm@${APP_BASE_DIGEST}`,
      '--app-base-image',
      `docker.io/minio/mc:RELEASE.2026-04-27T12-00-00Z@${APP_MC_DIGEST}`,
      '--llmup-base-image',
      `docker.io/library/rust:1.88-bookworm@${LLMUP_RUST_BASE_DIGEST}`,
      '--llmup-base-image',
      `docker.io/library/debian:bookworm-slim@${LLMUP_RUNTIME_BASE_DIGEST}`,
      ...extraArgs,
    ],
    env: {
      ...process.env,
      BUILD_ARTIFACT_BROKER_IMAGE_DIGEST_COMMAND: fixture.digestProbePath,
      BUILD_ARTIFACT_BROKER_GENERATED_AT: GENERATED_AT,
      BUILD_ARTIFACT_BROKER_RUN_ID: RUN_ID,
    },
    stdout: () => undefined,
    stderr: () => undefined,
  });
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
  it('scans app and llmup sources with stable exclusions and writes an aggregate manifest', () => {
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
        'llmup',
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
      writeFile(path.join(fixture.llmupSourceDir, 'target', 'debug', 'llmup'), 'changed excluded target\n');
      writeFile(path.join(fixture.llmupSourceDir, 'dist', 'bundle'), 'changed excluded dist\n');
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
      expect(thirdDigests.llmup).toBe(secondDigests.llmup);

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
      expect(fourthDigests.llmup).toBe(thirdDigests.llmup);
    } finally {
      rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  it('writes a structured diagnostic report instead of an invalid manifest when an image digest is missing', () => {
    const fixture = stageBrokerFixture();

    try {
      writeExecutable(
        fixture.digestProbePath,
        `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  *agentsmith-app*) printf '%s\\n' '${APP_IMAGE_DIGEST}' ;;
  *) exit 1 ;;
esac
`,
      );

      expect(runBroker(fixture)).toBe(0);

      const manifestPath = path.join(fixture.releaseRoot, 'build-manifest.json');
      const reportPath = path.join(fixture.releaseRoot, 'build-artifact-broker-report.json');
      const report = readJson(reportPath);

      expect(existsSync(manifestPath)).toBe(false);
      expect(report).toMatchObject({
        report_kind: 'build_artifact_broker_diagnostic',
        release_id: 'release-20260427',
      });
      expect(JSON.stringify(report)).toContain('missing_image_digest');
      expect(JSON.stringify(report)).toContain('llmup');
      expect(findForbiddenEvidenceTruthField(report)).toBeNull();
    } finally {
      rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  });

  it('writes a diagnostic report when the llmup Dockerfile copies tests outside the runtime key model', () => {
    const fixture = stageBrokerFixture();

    try {
      writeFile(path.join(fixture.llmupSourceDir, 'Dockerfile'), 'FROM rust\nCOPY tests ./tests\nCOPY src ./src\n');

      expect(runBroker(fixture)).toBe(0);

      const manifestPath = path.join(fixture.releaseRoot, 'build-manifest.json');
      const reportPath = path.join(fixture.releaseRoot, 'build-artifact-broker-report.json');
      const report = readJson(reportPath);

      expect(existsSync(manifestPath)).toBe(false);
      expect(JSON.stringify(report)).toContain('llmup_runtime_tests_copy_present');
      expect(JSON.stringify(report)).toContain('Dockerfile');
      expect(findForbiddenEvidenceTruthField(report)).toBeNull();
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
