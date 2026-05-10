import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const CHAT_BACKEND_REAL_SESSION_NAME = 'chat-backend-real-endpoint';
const CHAT_BACKEND_REAL_SESSION_COMMAND = 'bash scripts/run-integration-e2e-full.sh --session chat-backend-real-endpoint';
const CHAT_BACKEND_REAL_SESSION_SHARDS = [
  {
    shard_id: 'chat-endpoint-real-completion',
    spec: 'e2e/integration-chat.spec.ts',
    grep: 'real deepseek',
  },
  {
    shard_id: 'chat-stop-escalation',
    spec: 'e2e/integration-chat.spec.ts',
    grep: 'stop escalation resyncs authoritative thread truth after refresh and keeps composer ready',
  },
] as const;

type MutableManifestWithSessionCoalescing = CurrentRealSessionCoverageManifest & {
  session_coalescing: Array<Record<string, unknown> & {
    id: string;
    shards: Array<Record<string, unknown>>;
  }>;
};

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

function chatSessionContract(manifest: unknown = CURRENT_REAL_SESSION_COVERAGE_MANIFEST) {
  const contracts = (manifest as { session_coalescing?: unknown }).session_coalescing;

  expect(contracts).toEqual(expect.any(Array));
  const contract = (contracts as Array<Record<string, unknown>>).find((candidate) => (
    candidate.session_name === CHAT_BACKEND_REAL_SESSION_NAME
  ));

  expect(contract).toBeDefined();
  return contract as Record<string, unknown> & {
    shards: Array<Record<string, unknown>>;
  };
}

function chatGrepEntry(spec: string, grep: string) {
  const entry = listCurrentRealSessionCoverageEntries().find((candidate) => (
    candidate.source_kind === 'playwright_grep'
    && candidate.spec === spec
    && candidate.grep === grep
  ));

  if (!entry) {
    throw new Error(`Missing chat grep coverage entry: ${spec} --grep ${grep}`);
  }
  return entry;
}

function cloneManifestWithSessionCoalescing(): MutableManifestWithSessionCoalescing {
  return structuredClone(CURRENT_REAL_SESSION_COVERAGE_MANIFEST) as MutableManifestWithSessionCoalescing;
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
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:agent-task:runner:backend-real' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:e2e:integration:chat:real' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:e2e:integration:agent-task' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:e2e:integration:agent-task:terminal:ux' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:agent-task:backend-real:runner' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:internal:backend-real:agent-task-workspace' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:e2e:integration:files:connector-absence' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:files:backend-real:home-binding' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:api-key-endpoint-access' }),
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:e2e:integration:universal-proxy:model-profile' }),
      expect.objectContaining({ source_kind: 'playwright_spec', spec: 'e2e/integration-release-user-story.spec.ts' }),
      expect.objectContaining({ source_kind: 'playwright_spec', spec: 'e2e/integration-files-connector-absence.spec.ts' }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-agent-task-runner.spec.ts',
        grep: 'uses feishu-docs managed credential projection in a real Agent Task run resolved by the default Agent Runner',
      }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-chat.spec.ts',
        grep: 'real deepseek',
      }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-universal-proxy-endpoint.spec.ts',
        grep: 'model profile runtime config',
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
      && entry.spec === 'e2e/integration-chat.spec.ts'
      && entry.grep === 'real deepseek'
    ));
    expectValidationFailure(
      missingGrep,
      'missing current real session coverage source: playwright_grep:e2e/integration-chat.spec.ts',
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
          ? [
            'run_grep e2e/integration-chat.spec.ts "real deepseek" 21001 3101',
            'run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "member context stays private between workspace members" 20079 3101 || skills_status=$?',
          ].join('\n')
          : undefined
      ),
    });

    expect(discovery.failures).toEqual([]);
    expect(discovery.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:new-backend-real' }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-chat.spec.ts',
        grep: 'real deepseek',
      }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-context-store-isolation.spec.ts',
        grep: 'member context stays private between workspace members',
      }),
    ]));
    expect(discovery.sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_kind: 'playwright_spec',
        spec: 'e2e/integration-context-store-isolation.spec.ts',
      }),
    ]));

    const directDiscovery = discoverCurrentRealSessionCoverageRequiredSources({
      includeStaticSourceFiles: false,
      packageScripts: {
        'test:direct-backend-real': 'scripts/direct-backend-real-gate.sh',
      },
      readShellFile: (relativePath) => (
        relativePath === 'scripts/direct-backend-real-gate.sh'
          ? 'npx playwright test e2e/integration-agent-task-runner.spec.ts --grep docker\n'
          : undefined
      ),
    });

    expect(directDiscovery.failures).toEqual([]);
    expect(directDiscovery.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: 'npm_script', npm_script: 'test:direct-backend-real' }),
      expect.objectContaining({
        source_kind: 'playwright_grep',
        spec: 'e2e/integration-agent-task-runner.spec.ts',
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

  it('models universal proxy model profile coverage as focused real-container endpoint evidence', () => {
    expect(npmScriptEntry('test:e2e:integration:universal-proxy:model-profile')).toMatchObject({
      proposed_shard_id: 'api-key-endpoint',
      evidence_owner: 'backend-real-provider:api-key-endpoint',
      isolation_level: 'serialized',
      mutable_resources: expect.arrayContaining([
        'workspace',
        'project',
        'endpoint_credentials',
        'shared_local_substrate',
        'local_ports',
      ]),
      lock_ids: ['shared-local-substrate', 'fixed-local-ports'],
      merge_allowed: false,
    });

    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const command = packageJson.scripts?.['test:e2e:integration:universal-proxy:model-profile'];
    expect(command).toContain('INTEGRATION_UNIVERSAL_PROXY_FORCE_MANAGED=1');
    expect(command).toContain('INTEGRATION_UNIVERSAL_PROXY_PORT=${INTEGRATION_UNIVERSAL_PROXY_PORT:-39084}');

    const grepEntry = listCurrentRealSessionCoverageEntries().find((entry) => (
      entry.source_kind === 'playwright_grep'
      && entry.spec === 'e2e/integration-universal-proxy-endpoint.spec.ts'
      && entry.grep === 'model profile runtime config'
    ));

    expect(grepEntry).toMatchObject({
      proposed_shard_id: 'api-key-endpoint',
      evidence_owner: 'backend-real-provider:api-key-endpoint',
      isolation_level: 'serialized',
      mutable_resources: expect.arrayContaining([
        'workspace',
        'project',
        'endpoint_credentials',
        'shared_local_substrate',
        'local_ports',
      ]),
      lock_ids: ['shared-local-substrate', 'fixed-local-ports'],
      merge_allowed: false,
    });
  });

  it('declares chat backend-real greps as one serial diagnostic session without changing merge safety', () => {
    const expectedEntries = CHAT_BACKEND_REAL_SESSION_SHARDS.map((shard) => chatGrepEntry(shard.spec, shard.grep));
    const contract = chatSessionContract();

    expect(contract).toMatchObject({
      id: CHAT_BACKEND_REAL_SESSION_NAME,
      session_name: CHAT_BACKEND_REAL_SESSION_NAME,
      session_command: CHAT_BACKEND_REAL_SESSION_COMMAND,
      strategy: 'serial_diagnostic_shards',
      evidence_scope: 'per_grep_shard',
      proposed_shard_id: 'chat-endpoint-real',
      evidence_owner: 'backend-real-chat:endpoint',
      stack_reuse: 'single_backend_real_stack_per_session',
    });
    expect(contract).not.toHaveProperty('verdict');
    expect(contract).not.toHaveProperty('claim_id');
    expect(contract).not.toHaveProperty('reusable');
    expect(contract.shards).toEqual(
      CHAT_BACKEND_REAL_SESSION_SHARDS.map((shard, index) => ({
        ...shard,
        coverage_id: expectedEntries[index]?.id,
        proposed_shard_id: 'chat-endpoint-real',
        evidence_owner: 'backend-real-chat:endpoint',
      })),
    );

    for (const entry of expectedEntries) {
      expect(entry).toMatchObject({
        proposed_shard_id: 'chat-endpoint-real',
        evidence_owner: 'backend-real-chat:endpoint',
        isolation_level: 'serialized',
        merge_allowed: false,
      });
    }

    const runner = readFileSync('scripts/run-integration-e2e-full.sh', 'utf8');
    expect(runner).toContain(CHAT_BACKEND_REAL_SESSION_NAME);
    expect(runner).toContain('run_backend_real_chat_endpoint_session_shards');
    for (const shard of CHAT_BACKEND_REAL_SESSION_SHARDS) {
      expect(runner).toContain(`run_playwright_shard "${shard.shard_id}" "${shard.spec}" --grep "${shard.grep}"`);
    }
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
    for (const field of ['runtime_truth', 'status', 'verdict', 'passed', 'claim_id', 'reusable'] as const) {
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

  it('rejects invalid session coalescing contracts fail-closed', () => {
    const unknownContractField = cloneManifestWithSessionCoalescing();
    unknownContractField.session_coalescing[0] = {
      ...unknownContractField.session_coalescing[0],
      parallel_hint: true,
    };
    expectValidationFailure(unknownContractField, 'unknown session coalescing contract field "parallel_hint"');

    const illegalStrategy = cloneManifestWithSessionCoalescing();
    illegalStrategy.session_coalescing[0] = {
      ...illegalStrategy.session_coalescing[0],
      strategy: 'parallel_greps',
    };
    expectValidationFailure(illegalStrategy, 'strategy is required and must be one of the current real session coalescing schema values');

    const missingGrepShard = cloneManifestWithSessionCoalescing();
    delete missingGrepShard.session_coalescing[0]?.shards[0]?.grep;
    expectValidationFailure(missingGrepShard, 'grep is required for session shard');

    const missingRequiredSessionShard = cloneManifestWithSessionCoalescing();
    missingRequiredSessionShard.session_coalescing[0].shards = missingRequiredSessionShard.session_coalescing[0].shards.slice(1);
    expectValidationFailure(missingRequiredSessionShard, 'missing required session shard chat-endpoint-real-completion');

    const extraValidShardWithReorderedRequiredShards = cloneManifestWithSessionCoalescing();
    const extraChatGrep = chatGrepEntry('e2e/integration-chat.spec.ts', 'real deepseek');
    const requiredChatShards = extraValidShardWithReorderedRequiredShards.session_coalescing[0].shards;
    extraValidShardWithReorderedRequiredShards.session_coalescing[0].shards = [
      requiredChatShards[1],
      requiredChatShards[0],
      ...requiredChatShards.slice(2),
      {
        coverage_id: extraChatGrep.id,
        shard_id: 'chat-real-deepseek',
        spec: extraChatGrep.spec,
        grep: extraChatGrep.grep,
        proposed_shard_id: extraChatGrep.proposed_shard_id,
        evidence_owner: extraChatGrep.evidence_owner,
      },
    ];
    expectValidationFailure(
      extraValidShardWithReorderedRequiredShards,
      `required session coalescing contract ${CHAT_BACKEND_REAL_SESSION_NAME} must declare the exact serial diagnostic shard list in order`,
    );
    expectValidationFailure(
      extraValidShardWithReorderedRequiredShards,
      `unknown/extra session shard chat-real-deepseek for required session coalescing contract ${CHAT_BACKEND_REAL_SESSION_NAME}`,
    );

    const runtimeSecondTruth = cloneManifestWithSessionCoalescing();
    runtimeSecondTruth.session_coalescing[0] = {
      ...runtimeSecondTruth.session_coalescing[0],
      reusable: true,
    };
    expectValidationFailure(runtimeSecondTruth, 'forbidden runtime truth field "reusable"');

    const mergeBypass = cloneManifestWithSessionCoalescing();
    const firstCoverageId = mergeBypass.session_coalescing[0]?.shards[0]?.coverage_id;
    const coverageIndex = mergeBypass.coverage.findIndex((entry) => entry.id === firstCoverageId);
    expect(coverageIndex).toBeGreaterThanOrEqual(0);
    mergeBypass.coverage[coverageIndex] = {
      ...mergeBypass.coverage[coverageIndex],
      isolation_level: 'workspace',
      mutable_resources: ['workspace'],
      lock_ids: [],
      merge_allowed: true,
    };
    expectValidationFailure(mergeBypass, 'session coalesced coverage must remain serialized with merge_allowed=false');
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
