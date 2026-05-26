import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENTSMITH_CANONICAL_REPO,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateRunnerContractArtifactDescriptor,
} from '../current-release-boundary-schema';
import {
  RUNNER_CONTRACT_ARTIFACT_DESCRIPTOR_NAME,
  RUNNER_CONTRACT_ARTIFACT_GENERATOR_COMMAND,
  RUNNER_CONTRACT_ARTIFACT_GENERATOR_VERSION,
  createRunnerContractArtifactDescriptor,
  runRunnerContractArtifactCli,
} from '../runner-contract-artifact';

const artifactSha256 = `sha256:${'a'.repeat(64)}`;
const artifactIntegrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;

describe('runner contract artifact producer', () => {
  it('fails fast instead of producing local descriptors when required GitHub env is missing', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'runner-contract-artifact-missing-env-'));
    const stderr: string[] = [];
    const stdout: string[] = [];

    try {
      const exitCode = runRunnerContractArtifactCli({
        argv: ['--output-dir', outputDir],
        env: {},
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      });

      expect(exitCode).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr.join('\n')).toContain(
        'missing required GitHub Actions environment variables: GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_WORKFLOW, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_JOB',
      );
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('builds a release descriptor with digest, integrity, entrypoints, and non-self-referential provenance', () => {
    const descriptor = createRunnerContractArtifactDescriptor({
      packageName: '@mbos/agent-runner-contract',
      packageVersion: '0.1.0',
      artifactFilename: 'mbos-agent-runner-contract-0.1.0.tgz',
      artifactUri:
        'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/123/mbos-agent-runner-contract-0.1.0.tgz',
      artifactSha256,
      artifactIntegrity,
      entrypoints: {
        version: './dist/artifact.js',
        schema: './dist/contract-schema.js',
        types: './dist/index.d.ts',
        fixtures: './dist/contract-schema.js',
      },
      ci: {
        producerRepo: AGENTSMITH_CANONICAL_REPO,
        commitSha: '1'.repeat(40),
        workflowName: 'Runner Contract Artifact',
        runId: '123',
        runAttempt: '1',
        job: 'produce-runner-contract-artifact',
        generatedAt: '2026-05-25T00:00:00.000Z',
      },
    });
    const descriptorSubject = structuredClone(descriptor) as Record<string, unknown>;
    delete descriptorSubject.artifact_provenance;

    expect(descriptor).toMatchObject({
      schema_version: 'agentsmith.runner-contract-artifact/v1',
      package: {
        name: '@mbos/agent-runner-contract',
        version: '0.1.0',
      },
      artifact: {
        filename: 'mbos-agent-runner-contract-0.1.0.tgz',
        uri:
          'gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/123/mbos-agent-runner-contract-0.1.0.tgz',
        sha256: artifactSha256,
        integrity: artifactIntegrity,
      },
      entrypoints: {
        version: './dist/artifact.js',
        schema: './dist/contract-schema.js',
        types: './dist/index.d.ts',
        fixtures: './dist/contract-schema.js',
      },
      artifact_provenance: {
        schema_version: 'agentsmith.artifact-provenance/v1',
        provenance_kind: 'ci_artifact',
        producer_repo: AGENTSMITH_CANONICAL_REPO,
        normalized_remote: AGENTSMITH_CANONICAL_REPO,
        commit_sha: '1'.repeat(40),
        subject_name: 'runner-contract-artifact',
        subject_uri: RUNNER_CONTRACT_ARTIFACT_DESCRIPTOR_NAME,
        workflow_name: 'Runner Contract Artifact',
        run_id: '123',
        run_attempt: '1',
        job: 'produce-runner-contract-artifact',
        artifact_sha256: artifactSha256,
        generated_at: '2026-05-25T00:00:00.000Z',
        generator_command: RUNNER_CONTRACT_ARTIFACT_GENERATOR_COMMAND,
        generator_version: RUNNER_CONTRACT_ARTIFACT_GENERATOR_VERSION,
        attestation: 'none',
      },
    });
    expect(descriptor.artifact_provenance.subject_sha256).toBe(
      sha256Digest(canonicalReleaseBoundaryJson(descriptorSubject)),
    );
    expect(descriptor.artifact_provenance.subject_sha256).not.toBe(
      sha256Digest(canonicalReleaseBoundaryJson(descriptor)),
    );
    expect(validateRunnerContractArtifactDescriptor(descriptor).ok).toBe(true);
  });
});
