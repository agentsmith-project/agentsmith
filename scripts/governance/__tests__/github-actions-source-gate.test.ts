import { describe, expect, it } from 'vitest';

import {
  GithubSourceGateSemanticError,
  assertSafeArtifactZipMetadata,
  isRetryableGithubSourceGateFailure,
  selectExactRunArtifact,
  selectSuccessfulWorkflowRunsByHeadSha,
} from '../github-actions-source-gate';

const RUN_ID = '27233217906';
const HEAD_SHA = '06108c5345263e89081400b5f30f3f67c7329369';

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7519142548,
    name: 'runner-release-manifest',
    url: 'https://api.github.com/repos/agentsmith-project/agentsmith-runner/actions/artifacts/7519142548',
    archive_download_url:
      'https://api.github.com/repos/agentsmith-project/agentsmith-runner/actions/artifacts/7519142548/zip',
    expired: false,
    expires_at: '2026-08-29T13:39:29.000Z',
    workflow_run: {
      id: Number(RUN_ID),
      head_sha: HEAD_SHA,
    },
    ...overrides,
  };
}

function verboseEntryCount(count: number, extraLines: readonly string[] = []): string {
  const noun = count === 1 ? 'entry' : 'entries';
  return [
    `  central directory contains ${count} ${noun}.`,
    ...extraLines,
  ].join('\n');
}

describe('GitHub Actions source gate helper', () => {
  it('selects exactly one non-expired artifact by name and run metadata', () => {
    const selection = selectExactRunArtifact({
      artifactsApi: {
        total_count: 1,
        artifacts: [artifact()],
      },
      artifactName: 'runner-release-manifest',
      runId: RUN_ID,
      headSha: HEAD_SHA,
    });

    expect(selection.artifactId).toBe(7519142548);
    expect(selection.artifactName).toBe('runner-release-manifest');
  });

  it.each([
    {
      name: 'missing',
      artifacts: [],
      expected: 'expected exactly one runner-release-manifest artifact; found 0',
    },
    {
      name: 'duplicate',
      artifacts: [artifact(), artifact({ id: 7519142999 })],
      expected: 'expected exactly one runner-release-manifest artifact; found 2',
    },
    {
      name: 'expired',
      artifacts: [artifact({ expired: true })],
      expected: 'runner-release-manifest artifact must not be expired',
    },
    {
      name: 'wrong run',
      artifacts: [artifact({ workflow_run: { id: 1, head_sha: HEAD_SHA } })],
      expected: `runner-release-manifest.workflow_run.id must be ${RUN_ID}; actual 1`,
    },
    {
      name: 'wrong commit',
      artifacts: [artifact({ workflow_run: { id: Number(RUN_ID), head_sha: 'f'.repeat(40) } })],
      expected: `runner-release-manifest.workflow_run.head_sha must be ${HEAD_SHA}`,
    },
  ])('fails fast on semantic artifact selection drift: $name', ({ artifacts, expected }) => {
    expect(() => selectExactRunArtifact({
      artifactsApi: {
        total_count: artifacts.length,
        artifacts,
      },
      artifactName: 'runner-release-manifest',
      runId: RUN_ID,
      headSha: HEAD_SHA,
    })).toThrow(expected);
  });

  it('keeps retry classification scoped to transport failures', () => {
    expect(isRetryableGithubSourceGateFailure(
      { stderr: 'gh: HTTP 500: server error' },
      { operation: 'json_api' },
    )).toBe(true);
    expect(isRetryableGithubSourceGateFailure(
      { statusCode: 429 },
      { operation: 'json_api' },
    )).toBe(true);
    expect(isRetryableGithubSourceGateFailure(
      { statusCode: 401 },
      { operation: 'artifact_zip_download', metadataProvesArtifactAvailable: true },
    )).toBe(true);
    expect(isRetryableGithubSourceGateFailure(
      { statusCode: 401 },
      { operation: 'json_api' },
    )).toBe(false);
    expect(isRetryableGithubSourceGateFailure(
      { semanticFailure: true, statusCode: 500 },
      { operation: 'artifact_zip_download', metadataProvesArtifactAvailable: true },
    )).toBe(false);
  });

  it('filters direct workflow run API responses to completed successful runs for the exact head sha', () => {
    const matches = selectSuccessfulWorkflowRunsByHeadSha({
      headSha: HEAD_SHA,
      runsApi: {
        workflow_runs: [
          {
            id: 101,
            name: 'Publish',
            head_sha: HEAD_SHA,
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.example/runs/101',
          },
          {
            id: 102,
            name: 'Wrong Commit',
            head_sha: 'f'.repeat(40),
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.example/runs/102',
          },
          {
            id: 103,
            name: 'Failed',
            head_sha: HEAD_SHA,
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.example/runs/103',
          },
          {
            id: 104,
            name: 'Running',
            head_sha: HEAD_SHA,
            status: 'in_progress',
            conclusion: null,
            html_url: 'https://github.example/runs/104',
          },
          {
            id: '105',
            name: 'String Id',
            head_sha: HEAD_SHA,
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.example/runs/105',
          },
        ],
      },
    });

    expect(matches).toEqual([
      {
        conclusion: 'success',
        databaseId: 101,
        headSha: HEAD_SHA,
        status: 'completed',
        url: 'https://github.example/runs/101',
        workflowName: 'Publish',
      },
    ]);
  });

  it('fails fast when direct workflow run API response shape drifts', () => {
    expect(() => selectSuccessfulWorkflowRunsByHeadSha({
      headSha: HEAD_SHA,
      runsApi: {
        runs: [],
      },
    })).toThrow(GithubSourceGateSemanticError);
  });

  it('accepts artifact zip entries that stay under the extraction root', () => {
    expect(() => assertSafeArtifactZipMetadata({
      entryList: 'release/manifest.json\nrelease/handoff-report.json\n',
      verboseListing: verboseEntryCount(2),
    })).not.toThrow();
  });

  it('accepts Info-ZIP single-entry central directory metadata', () => {
    expect(() => assertSafeArtifactZipMetadata({
      entryList: 'release/manifest.json\n',
      verboseListing: verboseEntryCount(1),
    })).not.toThrow();
  });

  it.each([
    {
      name: 'absolute path',
      entryList: '/tmp/manifest.json\n',
      verboseListing: verboseEntryCount(1),
      expected: 'relative path',
    },
    {
      name: 'dot dot segment',
      entryList: 'release/../manifest.json\n',
      verboseListing: verboseEntryCount(1),
      expected: "'..' path segments",
    },
    {
      name: 'empty entry',
      entryList: 'release/manifest.json\n\nrelease/report.json\n',
      verboseListing: verboseEntryCount(3),
      expected: 'must not be empty',
    },
    {
      name: 'Windows drive path',
      entryList: 'C:/manifest.json\n',
      verboseListing: verboseEntryCount(1),
      expected: 'Windows drive path',
    },
    {
      name: 'Windows path separator',
      entryList: 'release\\manifest.json\n',
      verboseListing: verboseEntryCount(1),
      expected: 'Windows path separators',
    },
    {
      name: 'newline in entry name',
      entryList: 'release\nmanifest.json\n',
      verboseListing: verboseEntryCount(1),
      expected: 'listing count must match',
    },
    {
      name: 'symlink metadata',
      entryList: 'release/link\n',
      verboseListing: verboseEntryCount(1, [
        '  Unix file attributes (120777 octal):            lrwxrwxrwx',
      ]),
      expected: 'must not be symlinks',
    },
  ])('rejects unsafe artifact zip entries before extraction: $name', ({ entryList, verboseListing, expected }) => {
    expect(() => assertSafeArtifactZipMetadata({
      entryList,
      verboseListing,
    })).toThrow(expected);
  });
});
