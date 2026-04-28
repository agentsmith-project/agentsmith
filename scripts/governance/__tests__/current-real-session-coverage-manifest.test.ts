import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listCurrentGateDefinitions } from '../current-gate-manifest';
import {
  CURRENT_REAL_SESSION_COVERAGE_MANIFEST,
  CURRENT_REAL_SESSION_COVERAGE_MANIFEST_SCHEMA,
  CURRENT_REAL_SESSION_COVERAGE_MANIFEST_VERSION,
  type CurrentRealSessionCoverageManifest,
  type CurrentRealSessionCoverageSourceReference,
  discoverCurrentRealSessionCoverageRequiredSources,
  listCurrentRealSessionCoverageEntries,
  listCurrentRealSessionCoverageRequiredSources,
  validateCurrentRealSessionCoverageManifest,
} from '../current-real-session-coverage-manifest';
import { findCurrentVerificationCampaignById } from '../current-verification-campaign-manifest';

function cloneManifest(): CurrentRealSessionCoverageManifest {
  return structuredClone(CURRENT_REAL_SESSION_COVERAGE_MANIFEST);
}

function expectValidationFailure(manifest: unknown, expectedReason: string): void {
  const result = validateCurrentRealSessionCoverageManifest(manifest);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining(expectedReason),
        }),
      ]),
    );
  }
}

function expectValidationFailureWithSources(
  manifest: unknown,
  requiredSources: readonly CurrentRealSessionCoverageSourceReference[],
  expectedReason: string,
): void {
  const result = validateCurrentRealSessionCoverageManifest(manifest, { requiredSources });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining(expectedReason),
        }),
      ]),
    );
  }
}

function npmScriptEntry(npmScript: string) {
  const entry = listCurrentRealSessionCoverageEntries().find((candidate) => (
    candidate.source_kind === 'npm_script' && candidate.npm_script === npmScript
  ));
  if (!entry) {
    throw new Error(`Missing npm_script coverage entry: ${npmScript}`);
  }
  return entry;
}

describe('current real session coverage manifest', () => {
  it('defines a read-only current gate/spec/grep to shard coverage manifest', () => {
    expect(CURRENT_REAL_SESSION_COVERAGE_MANIFEST_SCHEMA).toBe('current-real-session-coverage-manifest.v1');
    expect(CURRENT_REAL_SESSION_COVERAGE_MANIFEST_VERSION).toBe(1);
    expect(CURRENT_REAL_SESSION_COVERAGE_MANIFEST).toMatchObject({
      schema: CURRENT_REAL_SESSION_COVERAGE_MANIFEST_SCHEMA,
      version: CURRENT_REAL_SESSION_COVERAGE_MANIFEST_VERSION,
    });
    expect(listCurrentRealSessionCoverageEntries()).toBe(CURRENT_REAL_SESSION_COVERAGE_MANIFEST.coverage);
    expect(validateCurrentRealSessionCoverageManifest()).toEqual({
      ok: true,
      value: CURRENT_REAL_SESSION_COVERAGE_MANIFEST,
    });

    for (const entry of listCurrentRealSessionCoverageEntries()) {
      expect(entry.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(entry.proposed_shard_id.length).toBeGreaterThan(0);
      expect(entry.evidence_owner.length).toBeGreaterThan(0);
      expect(entry.mutable_resources.length).toBeGreaterThan(0);
      expect(entry.lock_ids.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry).not.toHaveProperty('status');
      expect(entry).not.toHaveProperty('verdict');
      expect(entry).not.toHaveProperty('passed');
      expect(entry).not.toHaveProperty('claim_id');
    }
  });

  it('covers every backend-real required current gate and the release campaign backend-real step', () => {
    const requiredBackendRealGates = listCurrentGateDefinitions()
      .filter((definition) => definition.backendRealPolicy === 'required')
      .map((definition) => definition.id);
    const currentGateEntries = listCurrentRealSessionCoverageEntries()
      .filter((entry) => entry.source_kind === 'current_gate')
      .map((entry) => entry.gate_id);

    expect(requiredBackendRealGates).toEqual([
      'test-backend-real-core',
      'lane-backend-real-core',
      'gate-release',
      'lane-backend-real-release',
      'gate-release-full',
    ]);
    expect(currentGateEntries).toEqual(expect.arrayContaining(requiredBackendRealGates));

    const releaseFull = findCurrentVerificationCampaignById('release-full');
    const gateRelease = releaseFull?.steps.find((step) => step.id === 'gate-release');
    const campaignEntry = listCurrentRealSessionCoverageEntries().find((entry) => (
      entry.source_kind === 'release_campaign_step'
      && entry.campaign_id === 'release-full'
      && entry.campaign_step_id === 'gate-release'
    ));

    expect(gateRelease?.lineKind).toBe('release_backend_real');
    expect(campaignEntry).toMatchObject({
      gate_id: 'gate-release',
      npm_script: 'gate:release',
      proposed_shard_id: 'release-backend-real',
      evidence_owner: 'release-campaign-step:gate-release',
      merge_allowed: false,
    });
  });

  it('discovers and maps current runner/backend-real npm scripts and spec/grep sources fail-closed', () => {
    const requiredSources = listCurrentRealSessionCoverageRequiredSources();

    expect(requiredSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:skills:backend-real' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:notebook:runner:backend-real' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:chat:runner:backend-real' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:e2e:integration:agents:chat' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:e2e:integration:notebook' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:e2e:integration:notebook:docker' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:internal:backend-real:chat' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:internal:backend-real:notebook-workspace' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:files:backend-real:sync' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:api-key-endpoint-access' }),
      expect.objectContaining({ source_kind: 'playwright_spec', spec: 'e2e/integration-release-user-story.spec.ts' }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-notebook-codex-runner.spec.ts',
        grep: 'docker',
      }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-notebook-codex-runner.spec.ts',
        grep: 'uses feishu-docs managed credential projection in a real notebook codex runner task',
      }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-chat.spec.ts',
        grep: 'real deepseek',
      }),
    ]));

    const missingScript = cloneManifest();
    missingScript.coverage = missingScript.coverage.filter((entry) => entry.npm_script !== 'test:skills:backend-real');
    expectValidationFailure(missingScript, 'missing current real session coverage source: npm_script:test:skills:backend-real');

    const missingGateReleaseScriptOnly = cloneManifest();
    missingGateReleaseScriptOnly.coverage = missingGateReleaseScriptOnly.coverage.filter((entry) => !(
      entry.source_kind === 'npm_script' && entry.npm_script === 'gate:release'
    ));
    expectValidationFailure(
      missingGateReleaseScriptOnly,
      'missing current real session coverage source: npm_script:gate:release',
    );

    const missingGrep = cloneManifest();
    missingGrep.coverage = missingGrep.coverage.filter((entry) => !(
      entry.source_kind === 'playwright_grep'
      && entry.spec === 'e2e/integration-chat-llm-runner.spec.ts'
      && entry.grep === 'streams multi-turn chat through the real local chat runner and persists replies'
    ));
    expectValidationFailure(
      missingGrep,
      'missing current real session coverage source: playwright_grep:e2e/integration-chat-llm-runner.spec.ts',
    );

    expectValidationFailureWithSources(
      cloneManifest(),
      [
        ...requiredSources,
        {
          source_kind: 'npm_script',
          npm_script: 'test:new-runner:backend-real',
        },
      ],
      'missing current real session coverage source: npm_script:test:new-runner:backend-real',
    );
  });

  it('discovers specs and greps from shell wrappers referenced by current real npm scripts', () => {
    const discovery = discoverCurrentRealSessionCoverageRequiredSources({
      includeStaticSourceFiles: false,
      packageScripts: {
        'test:new-backend-real': 'bash scripts/new-backend-real-gate.sh',
      },
      readShellFile: (relativePath) => (
        relativePath === 'scripts/new-backend-real-gate.sh'
          ? 'run_grep e2e/integration-chat-llm-runner.spec.ts "streams multi-turn chat through the real local chat runner and persists replies" 21001 3101\n'
          : undefined
      ),
    });

    expect(discovery.failures).toEqual([]);
    expect(discovery.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:new-backend-real' }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-chat-llm-runner.spec.ts',
        grep: 'streams multi-turn chat through the real local chat runner and persists replies',
      }),
    ]));

    const directDiscovery = discoverCurrentRealSessionCoverageRequiredSources({
      includeStaticSourceFiles: false,
      packageScripts: {
        'test:direct-backend-real': 'scripts/direct-backend-real-gate.sh',
      },
      readShellFile: (relativePath) => (
        relativePath === 'scripts/direct-backend-real-gate.sh'
          ? 'npx playwright test e2e/integration-notebook-codex-runner.spec.ts --grep docker\n'
          : undefined
      ),
    });

    expect(directDiscovery.failures).toEqual([]);
    expect(directDiscovery.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:direct-backend-real' }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-notebook-codex-runner.spec.ts',
        grep: 'docker',
      }),
    ]));

    const missingShell = discoverCurrentRealSessionCoverageRequiredSources({
      includeStaticSourceFiles: false,
      packageScripts: {
        'test:new-backend-real': 'sh scripts/missing-backend-real-gate.sh',
      },
      readShellFile: () => undefined,
    });

    expect(missingShell.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: expect.stringContaining('current real session npm script references missing shell file: scripts/missing-backend-real-gate.sh'),
      }),
    ]));

    const missingShellValidation = validateCurrentRealSessionCoverageManifest(
      CURRENT_REAL_SESSION_COVERAGE_MANIFEST,
      {
        discoveryOptions: {
          includeStaticSourceFiles: false,
          packageScripts: {
            'test:new-backend-real': 'sh scripts/missing-backend-real-gate.sh',
          },
          readShellFile: () => undefined,
        },
      },
    );

    expect(missingShellValidation.ok).toBe(false);
    if (!missingShellValidation.ok) {
      expect(missingShellValidation.failures).toEqual(expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining('current real session npm script references missing shell file: scripts/missing-backend-real-gate.sh'),
        }),
      ]));
    }
  });

  it('keeps broad lane and aggregate-only npm script modeling accurate', () => {
    expect(npmScriptEntry('test:e2e:lane:backend-real')).toMatchObject({
      proposed_shard_id: 'backend-real-substrate',
      evidence_owner: 'current-gate-result:lane-backend-real-core',
      isolation_level: 'serialized',
      mutable_resources: expect.arrayContaining([
        'workspace',
        'project',
        'runner_task',
        'context_store',
        'files',
        'usage_audit',
        'provider_quota',
        'shared_local_substrate',
      ]),
      merge_allowed: false,
    });

    expect(npmScriptEntry('verify:release-real')).toMatchObject({
      proposed_shard_id: 'release-backend-real',
      evidence_owner: 'current-gate-result:lane-backend-real-release',
      isolation_level: 'process',
      mutable_resources: expect.arrayContaining([
        'release_campaign_root',
        'provider_quota',
        'visual_artifacts',
        'internal_k8s',
        'shared_local_substrate',
      ]),
      merge_allowed: false,
    });

    expect(npmScriptEntry('gate:release:full')).toMatchObject({
      proposed_shard_id: 'release-backend-real',
      evidence_owner: 'current-gate-result:gate-release-full',
      isolation_level: 'serialized',
      mutable_resources: ['release_campaign_root'],
      lock_ids: ['release-campaign-root-writes'],
      merge_allowed: false,
    });
  });

  it('rejects illegal lock ids, evidence owners, and source references', () => {
    const badLock = cloneManifest();
    badLock.coverage[0] = {
      ...badLock.coverage[0],
      lock_ids: ['not-a-current-lock'],
    };
    expectValidationFailure(badLock, 'unknown lock_ids value "not-a-current-lock"');

    const badEvidenceOwner = cloneManifest();
    badEvidenceOwner.coverage[0] = {
      ...badEvidenceOwner.coverage[0],
      evidence_owner: 'release-verdict:passed' as never,
    };
    expectValidationFailure(badEvidenceOwner, 'evidence_owner is required');

    const badNpmScript = cloneManifest();
    badNpmScript.coverage[0] = {
      ...badNpmScript.coverage[0],
      npm_script: 'test:missing:backend-real',
    };
    expectValidationFailure(badNpmScript, 'unknown npm script "test:missing:backend-real"');

    const badSpec = cloneManifest();
    badSpec.coverage[0] = {
      ...badSpec.coverage[0],
      source_kind: 'playwright_spec',
      spec: 'e2e/not-integration.spec.ts',
    };
    expectValidationFailure(badSpec, 'spec must reference a current e2e integration spec');

    const npmScriptWithSpec = cloneManifest();
    const npmScriptIndex = npmScriptWithSpec.coverage.findIndex((entry) => entry.source_kind === 'npm_script');
    expect(npmScriptIndex).toBeGreaterThanOrEqual(0);
    npmScriptWithSpec.coverage[npmScriptIndex] = {
      ...npmScriptWithSpec.coverage[npmScriptIndex],
      spec: 'e2e/integration-chat.spec.ts',
    };
    expectValidationFailure(npmScriptWithSpec, 'npm_script coverage must not declare spec');

    const specWithNpmScript = cloneManifest();
    const specIndex = specWithNpmScript.coverage.findIndex((entry) => entry.source_kind === 'playwright_spec');
    expect(specIndex).toBeGreaterThanOrEqual(0);
    specWithNpmScript.coverage[specIndex] = {
      ...specWithNpmScript.coverage[specIndex],
      npm_script: 'test:skills:backend-real',
    };
    expectValidationFailure(specWithNpmScript, 'playwright_spec coverage must not declare npm_script');

    const grepWithGate = cloneManifest();
    const grepIndex = grepWithGate.coverage.findIndex((entry) => entry.source_kind === 'playwright_grep');
    expect(grepIndex).toBeGreaterThanOrEqual(0);
    grepWithGate.coverage[grepIndex] = {
      ...grepWithGate.coverage[grepIndex],
      gate_id: 'gate-release',
    };
    expectValidationFailure(grepWithGate, 'playwright_grep coverage must not declare gate_id');
  });

  it('rejects runtime truth, verdict, status, passed, and claim fields anywhere in the mapping', () => {
    for (const field of ['runtime_truth', 'status', 'verdict', 'passed', 'claim_id'] as const) {
      const manifest = cloneManifest() as unknown as Record<string, unknown> & {
        coverage: Array<Record<string, unknown>>;
      };
      manifest.coverage[0][field] = 'runtime-value';

      expectValidationFailure(manifest, `forbidden runtime truth field "${field}"`);
    }
  });

  it('allows merge only for proven isolated safe items', () => {
    const unsafeMerge = cloneManifest();
    unsafeMerge.coverage[0] = {
      ...unsafeMerge.coverage[0],
      isolation_level: 'workspace',
      merge_allowed: true,
    };

    expectValidationFailure(unsafeMerge, 'merge_allowed=true is not allowed for ws_default');

    const unsafeLockMerge = cloneManifest();
    unsafeLockMerge.coverage[0] = {
      ...unsafeLockMerge.coverage[0],
      mutable_resources: ['workspace'],
      isolation_level: 'workspace',
      merge_allowed: true,
    };

    expectValidationFailure(unsafeLockMerge, 'merge_allowed=true is not allowed while high-risk real-lane locks are required');
  });

  it('keeps the contract CLI aligned with the manifest', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-current-real-session-coverage.ts'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
