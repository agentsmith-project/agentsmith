import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA,
  PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID,
  TYPECHECK_NEXT_TYPEGEN_REQUIRED_ARTIFACTS,
  readPureCheckProducerEvidence,
  validatePureCheckProducerEvidence,
  writePureCheckProducerEvidence,
  type PureCheckProducerEvidenceRecord,
} from '../pure-check-producer-evidence';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const STARTED_AT = '2026-04-25T12:00:00.000Z';
const FINISHED_AT = '2026-04-25T12:00:03.250Z';
const GENERATED_AT = '2026-04-25T12:00:04.000Z';

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agentsmith-pure-producer-'));
  tempRoots.push(root);
  return root;
}

async function writeFixture(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(root, relativePath);
  await mkdir(join(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, content);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('pure check producer evidence', () => {
  it('writes and reads a passed producer-owned result with the result artifact included', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');

    const writeResult = await writePureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'contracts',
      resultStatus: 'passed',
      failureClass: 'none',
      exitCode: 0,
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      generatedAt: GENERATED_AT,
      stdoutSummary: 'contracts ok',
      stderrSummary: null,
    });

    expect(writeResult).toMatchObject({
      ok: true,
      evidence_dir: join(reportRoot, 'pure-check-producer', 'contracts'),
      path: join(reportRoot, 'pure-check-producer', 'contracts', 'result.json'),
    });
    expect(writeResult.ok && writeResult.digest).toMatch(DIGEST_PATTERN);

    const readResult = await readPureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'contracts',
    });

    expect(readResult.ok).toBe(true);
    if (!readResult.ok) {
      return;
    }
    expect(readResult.value).toMatchObject({
      schema: PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA,
      check_id: 'contracts',
      owning_job_id: 'standalone-gate-fast',
      gate_id: 'gate-fast',
      command: 'npm run contracts:check',
      npm_script: 'contracts:check',
      result_status: 'passed',
      failure_class: 'none',
      exit_code: 0,
      started_at: STARTED_AT,
      finished_at: FINISHED_AT,
      duration_ms: 3250,
      generated_at: GENERATED_AT,
    });
    expect(readResult.value.stdout_summary_digest).toEqual({
      digest: sha256('contracts ok'),
      summary_length: 'contracts ok'.length,
      redacted: false,
    });
    expect(readResult.value.stderr_summary_digest).toEqual({
      digest: null,
      summary_length: 0,
      redacted: false,
    });
    expect(readResult.value.required_artifacts).toContainEqual({
      id: PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID,
      scope: 'evidence_dir',
      path: 'result.json',
      kind: 'file',
      digest: null,
      size_bytes: null,
    });
  });

  it('writes and reads a failed result with a non-none failure class', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');

    const writeResult = await writePureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'unit',
      resultStatus: 'failed',
      failureClass: 'product_regression',
      exitCode: 1,
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      generatedAt: GENERATED_AT,
      stdoutSummary: 'unit failed',
      stderrSummary: 'expected true to be false',
    });

    expect(writeResult.ok).toBe(true);

    const readResult = await readPureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'unit',
    });

    expect(readResult.ok).toBe(true);
    if (!readResult.ok) {
      return;
    }
    expect(readResult.value).toMatchObject({
      check_id: 'unit',
      gate_id: 'gate-default',
      command: 'npm run test:run',
      npm_script: 'test:run',
      result_status: 'failed',
      failure_class: 'product_regression',
      exit_code: 1,
    });
    expect(readResult.value.stderr_summary_digest.digest).toBe(sha256('expected true to be false'));
  });

  it('fails closed when a required artifact is missing', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');
    const writeResult = await writePureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'contracts',
      resultStatus: 'passed',
      failureClass: 'none',
      exitCode: 0,
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      generatedAt: GENERATED_AT,
      stdoutSummary: 'contracts ok',
      stderrSummary: null,
    });

    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) {
      return;
    }

    const invalidRecord: PureCheckProducerEvidenceRecord = {
      ...writeResult.record,
      required_artifacts: [
        ...writeResult.record.required_artifacts,
        {
          id: 'missing-artifact',
          scope: 'repo_root',
          path: 'artifacts/missing.txt',
          kind: 'file',
          digest: `sha256:${'1'.repeat(64)}`,
          size_bytes: 1,
        },
      ],
    };

    const validation = await validatePureCheckProducerEvidence(invalidRecord, {
      repoRoot: root,
      reportRoot,
      expectedCheckId: 'contracts',
    });

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.failures).toContainEqual(expect.objectContaining({
        code: 'required_artifact_missing',
        path: 'required_artifacts[1].path',
      }));
    }
  });

  it('records and validates typecheck next-typegen artifact digests', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');
    await writeFixture(root, '.next/types/routes.d.ts', 'declare const routes: "/";\n');
    await writeFixture(root, 'next-env.d.ts', '/// <reference types="next" />\n');

    const writeResult = await writePureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'typecheck',
      resultStatus: 'passed',
      failureClass: 'none',
      exitCode: 0,
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      generatedAt: GENERATED_AT,
      stdoutSummary: 'typecheck ok',
      stderrSummary: null,
      requiredArtifacts: TYPECHECK_NEXT_TYPEGEN_REQUIRED_ARTIFACTS,
    });

    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) {
      return;
    }

    const readResult = await readPureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'typecheck',
    });

    expect(readResult.ok).toBe(true);
    if (!readResult.ok) {
      return;
    }
    expect(readResult.value.required_artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'next-typegen-routes',
        scope: 'repo_root',
        path: '.next/types/routes.d.ts',
        digest: sha256('declare const routes: "/";\n'),
        size_bytes: 'declare const routes: "/";\n'.length,
      }),
      expect.objectContaining({
        id: 'next-env',
        scope: 'repo_root',
        path: 'next-env.d.ts',
        digest: sha256('/// <reference types="next" />\n'),
        size_bytes: '/// <reference types="next" />\n'.length,
      }),
    ]));
  });

  it('redacts secret-looking summaries before storing digest material', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');
    const stdoutSecret = 'Bearer stdout-secret-token';
    const stderrSecret = 'client_secret=stderr-secret-token';

    const writeResult = await writePureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'lint',
      resultStatus: 'passed',
      failureClass: 'none',
      exitCode: 0,
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      generatedAt: GENERATED_AT,
      stdoutSummary: `lint ok ${stdoutSecret}`,
      stderrSummary: stderrSecret,
    });

    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) {
      return;
    }

    const rawResult = await readFile(writeResult.path, 'utf8');
    expect(rawResult).not.toContain('stdout-secret-token');
    expect(rawResult).not.toContain('stderr-secret-token');
    expect(writeResult.record.stdout_summary_digest.redacted).toBe(true);
    expect(writeResult.record.stderr_summary_digest.redacted).toBe(true);
    expect(writeResult.record.stdout_summary_digest.digest).toBe(sha256('lint ok Bearer [redacted]'));
    expect(writeResult.record.stderr_summary_digest.digest).toBe(sha256('client_secret=[redacted]'));
  });

  it('fails closed on unknown keys', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');
    const writeResult = await writePureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'contracts',
      resultStatus: 'passed',
      failureClass: 'none',
      exitCode: 0,
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      generatedAt: GENERATED_AT,
      stdoutSummary: 'contracts ok',
      stderrSummary: null,
    });

    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) {
      return;
    }

    const validation = await validatePureCheckProducerEvidence(
      { ...writeResult.record, unexpected_scope: 'debug' },
      {
        repoRoot: root,
        reportRoot,
        expectedCheckId: 'contracts',
      },
    );

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.failures).toContainEqual(expect.objectContaining({
        code: 'unknown_key',
        path: 'unexpected_scope',
      }));
    }
  });

  it('fails closed when a required artifact digest mismatches the file content', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');
    await writeFixture(root, '.next/types/routes.d.ts', 'declare const routes: "/";\n');
    await writeFixture(root, 'next-env.d.ts', '/// <reference types="next" />\n');

    const writeResult = await writePureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'typecheck',
      resultStatus: 'passed',
      failureClass: 'none',
      exitCode: 0,
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      generatedAt: GENERATED_AT,
      stdoutSummary: 'typecheck ok',
      stderrSummary: null,
      requiredArtifacts: TYPECHECK_NEXT_TYPEGEN_REQUIRED_ARTIFACTS,
    });

    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) {
      return;
    }

    const invalidRecord: PureCheckProducerEvidenceRecord = {
      ...writeResult.record,
      required_artifacts: writeResult.record.required_artifacts.map((artifact) => (
        artifact.id === 'next-env'
          ? { ...artifact, digest: `sha256:${'0'.repeat(64)}` }
          : artifact
      )),
    };

    const validation = await validatePureCheckProducerEvidence(invalidRecord, {
      repoRoot: root,
      reportRoot,
      expectedCheckId: 'typecheck',
    });

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.failures).toContainEqual(expect.objectContaining({
        code: 'required_artifact_digest_mismatch',
        path: 'required_artifacts[2].digest',
      }));
    }
  });
});
