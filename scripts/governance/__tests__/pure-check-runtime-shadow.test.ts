import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  validateCurrentEvidenceClaim,
  type CurrentEvidenceClaimRecord,
} from '../current-evidence-claim-schema';
import {
  findCurrentPureCheckIdentityById,
  type CurrentPureCheckIdentity,
  type CurrentPureCheckInputDigestRule,
} from '../current-pure-check-identity-manifest';
import {
  appendEvidenceClaimJsonl,
  appendStablePureCheckClaimJsonl,
  buildPureCheckRuntimeShadowClaimRecord,
  computeEvidenceClaimDigest,
  computePureCheckArtifactDigest,
  computePureCheckInputDigest,
  computePureCheckResultDigest,
  evaluatePureCheckRuntimeShadowForVerifyRunSync,
  readEvidenceClaimJsonlStore,
  readStablePureCheckClaimJsonlStore,
  STABLE_PURE_CHECK_CLAIMS_JSONL_PATH,
} from '../pure-check-runtime-shadow';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

const TEST_RULE: CurrentPureCheckInputDigestRule = {
  id: 'test-static-inputs-v1',
  description: 'Test rule for runtime shadow digest coverage.',
  material_policy: 'declared_path_globs_plus_toolchain',
  toolchain_inputs: ['node', 'npm', 'package-lock'],
};

const BASE_IDENTITY: CurrentPureCheckIdentity = {
  check_id: 'contracts',
  command: 'npm run contracts:check',
  npm_script: 'contracts:check',
  owning_gate_id: 'gate-fast',
  owning_job_id: 'standalone-gate-fast',
  path_globs: [
    'src/**/*.ts',
    'src',
    'missing/**/*.ts',
    'package-lock.json',
  ],
  cache_policy: 'shadow',
  input_digest_rule_id: TEST_RULE.id,
};

const TEST_TOOLCHAIN = {
  node: 'node-v24.14.1-test-secret-token',
  npm: 'npm-v11.11.0',
  'package-lock': 'lockfile-version-3',
};

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agentsmith-pure-shadow-'));
  tempRoots.push(root);
  return root;
}

async function writeFixture(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(root, relativePath);
  await mkdir(join(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, content);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('pure check runtime shadow', () => {
  it('computes stable input digests from sorted normalized files, git sha, and redacted toolchain identity', async () => {
    const root = await makeTempRoot();
    await writeFixture(root, 'src/z.ts', 'export const z = 1;\n');
    await writeFixture(root, 'src/nested/a.ts', 'export const a = 1;\n');
    await writeFixture(root, 'package-lock.json', '{"lockfileVersion":3}\n');

    const first = await computePureCheckInputDigest({
      repoRoot: root,
      identity: BASE_IDENTITY,
      inputDigestRule: TEST_RULE,
      gitSha: 'abc1234',
      toolchainIdentity: TEST_TOOLCHAIN,
    });
    const reordered = await computePureCheckInputDigest({
      repoRoot: root,
      identity: {
        ...BASE_IDENTITY,
        path_globs: [...BASE_IDENTITY.path_globs].reverse(),
      },
      inputDigestRule: TEST_RULE,
      gitSha: 'abc1234',
      toolchainIdentity: TEST_TOOLCHAIN,
    });

    expect(first.input_digest).toMatch(DIGEST_PATTERN);
    expect(reordered.input_digest).toBe(first.input_digest);
    expect(first.audit.matched_files.map((entry) => entry.path)).toEqual([
      'package-lock.json',
      'src/nested/a.ts',
      'src/z.ts',
    ]);
    expect(first.audit.reasons).toContainEqual(expect.objectContaining({
      code: 'path_glob_missing',
      path_glob: 'missing/**/*.ts',
    }));
    expect(first.audit.reasons).toContainEqual(expect.objectContaining({
      code: 'directory_ignored',
      path: 'src',
    }));
    expect(JSON.stringify(first.audit)).not.toContain(TEST_TOOLCHAIN.node);

    await writeFixture(root, 'src/nested/a.ts', 'export const a = 2;\n');
    const changedFile = await computePureCheckInputDigest({
      repoRoot: root,
      identity: BASE_IDENTITY,
      inputDigestRule: TEST_RULE,
      gitSha: 'abc1234',
      toolchainIdentity: TEST_TOOLCHAIN,
    });
    const changedGitSha = await computePureCheckInputDigest({
      repoRoot: root,
      identity: BASE_IDENTITY,
      inputDigestRule: TEST_RULE,
      gitSha: 'def5678',
      toolchainIdentity: TEST_TOOLCHAIN,
    });

    expect(changedFile.input_digest).not.toBe(first.input_digest);
    expect(changedGitSha.input_digest).not.toBe(changedFile.input_digest);
  });

  it('computes artifact digests from existing files and directories while auditing missing refs', async () => {
    const root = await makeTempRoot();
    await writeFixture(root, 'artifacts/result.json', '{"status":"passed"}\n');
    await writeFixture(root, 'artifacts/logs/stdout.txt', 'stable stdout\n');

    const first = await computePureCheckArtifactDigest({
      repoRoot: root,
      command: 'npm run contracts:check',
      artifactRefs: [
        { id: 'result', path: 'artifacts/result.json', kind: 'file' },
        { id: 'logs', path: 'artifacts/logs', kind: 'directory' },
        { id: 'missing', path: 'artifacts/missing.txt', kind: 'file' },
      ],
    });
    const second = await computePureCheckArtifactDigest({
      repoRoot: root,
      command: 'npm run contracts:check',
      artifactRefs: [
        { id: 'missing', path: './artifacts/missing.txt', kind: 'file' },
        { id: 'logs', path: 'artifacts/logs/', kind: 'directory' },
        { id: 'result', path: 'artifacts/result.json', kind: 'file' },
      ],
    });

    expect(first.artifact_digest).toMatch(DIGEST_PATTERN);
    expect(second.artifact_digest).toBe(first.artifact_digest);
    expect(first.audit.artifacts.map((artifact) => artifact.path)).toEqual([
      'artifacts/logs/stdout.txt',
      'artifacts/result.json',
    ]);
    expect(first.audit.reasons).toContainEqual(expect.objectContaining({
      code: 'artifact_missing',
      artifact_ref_id: 'missing',
      path: 'artifacts/missing.txt',
    }));

    await writeFixture(root, 'artifacts/logs/stdout.txt', 'changed stdout\n');
    const changed = await computePureCheckArtifactDigest({
      repoRoot: root,
      command: 'npm run contracts:check',
      artifactRefs: [
        { id: 'result', path: 'artifacts/result.json', kind: 'file' },
        { id: 'logs', path: 'artifacts/logs', kind: 'directory' },
      ],
    });

    expect(changed.artifact_digest).not.toBe(first.artifact_digest);
  });

  it('redacts secret-looking result summaries before hashing or auditing', () => {
    const first = computePureCheckResultDigest({
      command: 'npm run contracts:check',
      resultStatus: 'passed',
      failureClass: 'none',
      exitCode: 0,
      stdoutSummary: 'ok Bearer secret-token-one',
      stderrSummary: 'client_secret=secret-token-two',
    });
    const sameRedactedShape = computePureCheckResultDigest({
      command: 'npm run contracts:check',
      resultStatus: 'passed',
      failureClass: 'none',
      exitCode: 0,
      stdoutSummary: 'ok Bearer changed-token-one',
      stderrSummary: 'client_secret=changed-token-two',
    });
    const failed = computePureCheckResultDigest({
      command: 'npm run contracts:check',
      resultStatus: 'failed',
      failureClass: 'product_regression',
      exitCode: 1,
      stdoutSummary: 'ok Bearer secret-token-one',
      stderrSummary: 'client_secret=secret-token-two',
    });

    expect(first.result_digest).toMatch(DIGEST_PATTERN);
    expect(sameRedactedShape.result_digest).toBe(first.result_digest);
    expect(failed.result_digest).not.toBe(first.result_digest);
    expect(first.audit.redactions).toEqual([
      { field: 'stdout_summary', reason: 'secret_like_value_redacted' },
      { field: 'stderr_summary', reason: 'secret_like_value_redacted' },
    ]);
    expect(JSON.stringify(first)).not.toContain('secret-token-one');
    expect(JSON.stringify(first)).not.toContain('secret-token-two');
  });

  it('builds pure check claim records that validate for pure_check_reuse and writes JSONL records', async () => {
    const root = await makeTempRoot();
    const identity = findCurrentPureCheckIdentityById('contracts');

    expect(identity).toBeDefined();
    if (!identity) {
      return;
    }

    const claimResult = buildPureCheckRuntimeShadowClaimRecord({
      identity,
      scope: 'debug',
      evidenceDir: 'artifacts/governance-runner-shell-plan/local-run/standalone-gate-fast',
      resultStatus: 'passed',
      failureClass: 'none',
      inputDigest: `sha256:${'1'.repeat(64)}`,
      artifactDigest: `sha256:${'2'.repeat(64)}`,
      resultDigest: `sha256:${'3'.repeat(64)}`,
      gitSha: 'abc1234',
      generatedAt: '2026-04-25T12:00:00.000Z',
      producerOrigin: 'test',
    });

    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) {
      return;
    }

    const claim = claimResult.value;
    expect(claim).toMatchObject({
      subject: 'pure-check.contracts.standalone-gate-fast',
      scope: 'debug',
      campaign_id: null,
      campaign_root: null,
      run_id: null,
      step_id: null,
      check_id: 'contracts',
      gate_id: 'gate-fast',
      line_kind: 'governance_run_quick',
      gate_adapter: {
        npm_script: 'contracts:check',
      },
      freshness: {
        git_sha: 'abc1234',
        allow_cross_commit: false,
        allow_cross_secret_profile: false,
        secret_profile_digest: null,
      },
    });
    expect(validateCurrentEvidenceClaim(claim, { purpose: 'pure_check_reuse' }).ok).toBe(true);

    const writeResult = await appendEvidenceClaimJsonl({
      runRoot: root,
      claim,
      validationPurpose: 'pure_check_reuse',
    });

    expect(writeResult).toMatchObject({
      ok: true,
      claim_digest: computeEvidenceClaimDigest(claim),
      path: join(root, 'evidence-claims.jsonl'),
    });

    const rawStore = await readFile(join(root, 'evidence-claims.jsonl'), 'utf8');
    expect(rawStore.trim().split('\n')).toHaveLength(1);

    const readResult = await readEvidenceClaimJsonlStore({
      runRoot: root,
      validationPurpose: 'pure_check_reuse',
    });

    expect(readResult).toEqual({
      ok: true,
      claims: [claim],
    });

    const stableWriteResult = await appendStablePureCheckClaimJsonl({
      repoRoot: root,
      claim,
      validationPurpose: 'pure_check_reuse',
    });

    expect(stableWriteResult).toMatchObject({
      ok: true,
      claim_digest: computeEvidenceClaimDigest(claim),
      path: join(root, STABLE_PURE_CHECK_CLAIMS_JSONL_PATH),
    });

    const stableReadResult = await readStablePureCheckClaimJsonlStore({
      repoRoot: root,
      validationPurpose: 'pure_check_reuse',
    });

    expect(stableReadResult).toEqual({
      ok: true,
      claims: [claim],
    });
  });

  it('fails closed before building a reusable passed claim when required artifacts are missing', async () => {
    const root = await makeTempRoot();
    const identity = findCurrentPureCheckIdentityById('contracts');

    expect(identity).toBeDefined();
    if (!identity) {
      return;
    }

    const artifactDigest = await computePureCheckArtifactDigest({
      repoRoot: root,
      command: 'npm run contracts:check',
      artifactRefs: [
        { id: 'required-result', path: 'artifacts/result.json', kind: 'file', required: true },
      ],
    });

    expect(artifactDigest.audit.required_artifacts_complete).toBe(false);
    expect(artifactDigest.audit.reasons).toContainEqual(expect.objectContaining({
      code: 'required_artifact_missing',
      artifact_ref_id: 'required-result',
      path: 'artifacts/result.json',
    }));

    const claimResult = buildPureCheckRuntimeShadowClaimRecord({
      identity,
      scope: 'debug',
      evidenceDir: 'artifacts/governance-runner-shell-plan/local-run/standalone-gate-fast',
      resultStatus: 'passed',
      failureClass: 'none',
      inputDigest: `sha256:${'1'.repeat(64)}`,
      artifactDigest: artifactDigest.artifact_digest,
      artifactAudit: artifactDigest.audit,
      resultDigest: `sha256:${'3'.repeat(64)}`,
      gitSha: 'abc1234',
      generatedAt: '2026-04-25T12:00:00.000Z',
      producerOrigin: 'test',
    });

    expect(claimResult.ok).toBe(false);
    if (!claimResult.ok) {
      expect(claimResult.failures).toContainEqual(expect.objectContaining({
        path: 'artifact_digest',
        code: 'required_artifact_missing',
      }));
    }
  });

  it('fails closed when reading invalid JSONL evidence claims', async () => {
    const root = await makeTempRoot();
    const identity = findCurrentPureCheckIdentityById('contracts');

    expect(identity).toBeDefined();
    if (!identity) {
      return;
    }

    const claimResult = buildPureCheckRuntimeShadowClaimRecord({
      identity,
      scope: 'debug',
      evidenceDir: 'artifacts/governance-runner-shell-plan/local-run/standalone-gate-fast',
      resultStatus: 'passed',
      failureClass: 'none',
      inputDigest: `sha256:${'1'.repeat(64)}`,
      artifactDigest: `sha256:${'2'.repeat(64)}`,
      resultDigest: `sha256:${'3'.repeat(64)}`,
      gitSha: 'abc1234',
      generatedAt: '2026-04-25T12:00:00.000Z',
      producerOrigin: 'test',
    });

    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) {
      return;
    }

    const validLine = JSON.stringify(claimResult.value satisfies CurrentEvidenceClaimRecord);
    await writeFixture(root, 'evidence-claims.jsonl', `${validLine}\n\n{bad json}\n`);

    const result = await readEvidenceClaimJsonlStore({
      runRoot: root,
      validationPurpose: 'pure_check_reuse',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures).toContainEqual(expect.objectContaining({
        line: 3,
        code: 'invalid_json',
      }));
    }
  });

  it('keeps report-root artifacts as audit-only digests until producer-owned adapters exist', async () => {
    const root = await makeTempRoot();
    await writeFixture(root, 'story-acceptance-report.json', '{"schema":"story-report"}\n');
    await writeFixture(root, 'verification-catalog.json', '{"schema":"verification-catalog"}\n');

    const result = evaluatePureCheckRuntimeShadowForVerifyRunSync({
      repoRoot: root,
      reportRoot: root,
      executedScripts: ['verify:quick'],
      generatedAt: '2026-04-25T12:00:00.000Z',
      gitSha: 'current-git-sha',
      toolchainIdentity: {
        node: 'node-v24.14.1',
        npm: 'npm-v11.11.0',
        'package-lock': 'lockfile-version-3',
        'next-typegen': 'next-typegen-v1',
      },
    });

    expect(result.evaluations.map((evaluation) => evaluation.check_id)).toEqual([
      'contracts',
      'openapi-contract',
      'openapi-generated',
      'lint',
      'typecheck',
    ]);
    expect(result.evaluations.every((evaluation) => evaluation.claim_store_write === false)).toBe(true);
    expect(result.evaluations.every((evaluation) => evaluation.decision === 'rerun_required')).toBe(true);
    expect(result.evaluations.every((evaluation) => evaluation.script_results.some((script) => (
      script.script === 'verify:quick'
      && script.result_status === 'passed'
      && script.failure_class === 'none'
    )))).toBe(true);
    expect(result.evaluations.every((evaluation) => evaluation.reason_codes.includes('producer_owned_artifact_adapter_missing')))
      .toBe(true);
    expect(result.evaluations.every((evaluation) => DIGEST_PATTERN.test(evaluation.audit_digests.input))).toBe(true);
    expect(result.evaluations.every((evaluation) => DIGEST_PATTERN.test(evaluation.audit_digests.artifact))).toBe(true);
    expect(result.evaluations.every((evaluation) => DIGEST_PATTERN.test(evaluation.audit_digests.result))).toBe(true);
    expect(result.evaluations.every((evaluation) => evaluation.audit_digests.claim === undefined)).toBe(true);
    expect(existsSync(join(root, 'evidence-claims.jsonl'))).toBe(false);
    expect(existsSync(join(root, STABLE_PURE_CHECK_CLAIMS_JSONL_PATH))).toBe(false);
  });

  it('does not write a reusable typecheck claim when next typegen input material is missing', async () => {
    const root = await makeTempRoot();
    await writeFixture(root, 'story-acceptance-report.json', '{"schema":"story-report"}\n');
    await writeFixture(root, 'verification-catalog.json', '{"schema":"verification-catalog"}\n');

    const result = evaluatePureCheckRuntimeShadowForVerifyRunSync({
      repoRoot: root,
      reportRoot: root,
      executedScripts: ['verify:quick'],
      generatedAt: '2026-04-25T12:00:00.000Z',
      gitSha: 'current-git-sha',
      toolchainIdentity: {
        node: 'node-v24.14.1',
        npm: 'npm-v11.11.0',
        'package-lock': 'lockfile-version-3',
      },
    });
    const typecheck = result.evaluations.find((evaluation) => evaluation.check_id === 'typecheck');

    expect(typecheck).toBeDefined();
    expect(typecheck).toMatchObject({
      check_id: 'typecheck',
      decision: 'rerun_required',
      claim_store_write: false,
    });
    expect(typecheck?.reason_codes).toEqual(expect.arrayContaining([
      'input_digest_incomplete',
      'toolchain_input_missing',
    ]));
    expect(typecheck?.audit_digests.claim).toBeUndefined();
    expect(existsSync(join(root, 'evidence-claims.jsonl'))).toBe(false);
    expect(existsSync(join(root, STABLE_PURE_CHECK_CLAIMS_JSONL_PATH))).toBe(false);
  });
});
