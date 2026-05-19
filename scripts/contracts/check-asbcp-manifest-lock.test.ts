import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkAsbcpManifestLock } from './check-asbcp-manifest-lock';

const CANONICAL_REPO = 'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane';
const SCHEMA_ID = 'https://agentsmith.dev/schemas/asbcp/final-manifest.v1.json';
const SCHEMA_VERSION = 'v1';
const DIGEST_A = `sha256:${'0123456789abcdef'.repeat(4)}`;
const DIGEST_B = `sha256:${'fedcba9876543210'.repeat(4)}`;
const COMMIT_A = '1234567890abcdef1234567890abcdef12345678';
const COMMIT_B = 'abcdef1234567890abcdef1234567890abcdef12';
const API_CONTRACT_VERSION = 'v1';
const BREAKING_CHANGE_ID = 'ASBCP-BC-0001';
const BREAKING_CHANGE_SUMMARY = 'pre-GA clean cut for ASBCP release evidence schema and active workload smoke naming; no compatibility aliases are kept for retired manager/sandbox release surfaces.';
const RISK_STATUS_SOURCE = 'docs/RISK_REGISTER.md release_blocking column';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'asbcp-manifest-lock-'));
  roots.push(root);
  return root;
}

function writeFixture(root: string, path: string, content: string): string {
  const fullPath = join(root, path);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function writeJsonFixture(root: string, path: string, value: Record<string, unknown>): string {
  return writeFixture(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeLock(
  root: string,
  overrides: Partial<{
    version: string;
    sourceImage: string;
    releaseUrl: string;
    commitSha: string;
    extraLines: string[];
  }> = {},
): string {
  const version = overrides.version ?? 'v1.2.3';
  return writeFixture(root, 'asbcp-image.lock', [
    `asbcp_version=${version}`,
    `asbcp_source_image=${overrides.sourceImage ?? `${CANONICAL_REPO}:${version}@${DIGEST_A}`}`,
    `asbcp_release_url=${overrides.releaseUrl ?? `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/${version}`}`,
    `asbcp_commit_sha=${overrides.commitSha ?? COMMIT_A}`,
    ...(overrides.extraLines ?? []),
    '',
  ].join('\n'));
}

function manifest(
  overrides: Partial<{
    schemaId: string;
    manifestSchemaVersion: string;
    version: string;
    gitTag: string;
    commitSha: string;
    imageRef: string;
    imageDigest: string;
    apiContractVersion: string;
    anonymousPull: Record<string, unknown>;
    sameDigestProof: Record<string, unknown>;
    sameDigestMatches: boolean;
    anonymousPullResult: string;
    knownBreakingChanges: unknown;
    changelogSummary: string;
    knownRiskStatus: string;
    knownRiskStatusSource: string;
    runbookUrl: string;
    releaseNotes: Record<string, unknown>;
    releaseGate: string;
  }> = {},
): Record<string, unknown> {
  const version = overrides.version ?? 'v1.2.3';
  const gitTag = overrides.gitTag ?? version;
  const commitSha = overrides.commitSha ?? COMMIT_A;
  const imageRef = overrides.imageRef ?? `${CANONICAL_REPO}:${version}@${overrides.imageDigest ?? DIGEST_A}`;
  const imageDigest = overrides.imageDigest ?? DIGEST_A;
  const tagRef = `${CANONICAL_REPO}:${version}`;
  const releaseUrl = `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/${version}`;
  return {
    schema_id: overrides.schemaId ?? SCHEMA_ID,
    manifest_schema_version: overrides.manifestSchemaVersion ?? SCHEMA_VERSION,
    asbcp_version: version,
    git_tag: gitTag,
    commit_sha: commitSha,
    image_ref: imageRef,
    image_digest: imageDigest,
    api_contract_version: overrides.apiContractVersion ?? API_CONTRACT_VERSION,
    anonymous_pull: overrides.anonymousPull ?? {
      result: overrides.anonymousPullResult ?? 'ok',
      tag_ref: tagRef,
      image_ref: imageRef,
      tag_resolved_digest: imageDigest,
      build_push_digest: imageDigest,
      anonymous_digest: imageDigest,
      docker_config: 'fresh-empty',
      commands: [
        `DOCKER_CONFIG=<fresh-empty> docker pull ${tagRef}`,
        `DOCKER_CONFIG=<fresh-empty> docker pull ${imageRef}`,
      ],
    },
    same_digest_proof: overrides.sameDigestProof ?? {
      tag_resolved_digest: imageDigest,
      build_push_digest: imageDigest,
      anonymous_digest: imageDigest,
      matches: overrides.sameDigestMatches ?? true,
      source: 'fresh-empty Docker config docker pull image:tag and image:tag@build_push_digest',
    },
    known_breaking_changes: overrides.knownBreakingChanges ?? [
      {
        id: BREAKING_CHANGE_ID,
        summary: BREAKING_CHANGE_SUMMARY,
      },
    ],
    changelog_summary: overrides.changelogSummary ?? 'ASBCP release evidence schema clean cut.',
    known_risk_status: overrides.knownRiskStatus ?? 'no release-blocking risks',
    known_risk_status_source: overrides.knownRiskStatusSource ?? RISK_STATUS_SOURCE,
    runbook_url: overrides.runbookUrl ?? `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/blob/${commitSha}/docs/runbooks/release.md`,
    release_notes: overrides.releaseNotes ?? {
      body_source: [
        '## ASBCP Release',
        `Version: ${version}`,
        `Git tag: ${gitTag}`,
        `Commit SHA: ${commitSha}`,
        `API contract version: ${overrides.apiContractVersion ?? API_CONTRACT_VERSION}`,
        `Image ref: \`${imageRef}\``,
        `Image digest: \`${imageDigest}\``,
        'Downstream image lock values:',
        `asbcp_version=${version}`,
        `asbcp_source_image=${imageRef}`,
        `asbcp_release_url=${releaseUrl}`,
        `asbcp_commit_sha=${commitSha}`,
      ].join('\n'),
      github_release_url: releaseUrl,
    },
    release_gate: overrides.releaseGate ?? 'scripts/verify-release.sh',
  };
}

function policy(
  overrides: Partial<{
    supportedApiContractVersions: string[];
    breakingChangesAllowlist: unknown;
    expiresOn: string;
  }> = {},
): Record<string, unknown> {
  return {
    schema_id: 'https://agentsmith.dev/schemas/agentsmith/asbcp-adoption-policy.v1.json',
    schema_version: 'v1',
    final_manifest_schema: {
      schema_id: SCHEMA_ID,
      manifest_schema_version: SCHEMA_VERSION,
    },
    supported_api_contract_versions: overrides.supportedApiContractVersions ?? [API_CONTRACT_VERSION],
    breaking_changes_allowlist: overrides.breakingChangesAllowlist ?? [
      {
        id: BREAKING_CHANGE_ID,
        summary: BREAKING_CHANGE_SUMMARY,
        expires_on: overrides.expiresOn ?? '2027-05-19',
      },
    ],
  };
}

function failureText(result: ReturnType<typeof checkAsbcpManifestLock>): string {
  return result.failures
    .map((failure) => `${failure.field}: ${failure.message}`)
    .join('\n');
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('checkAsbcpManifestLock', () => {
  it('accepts a release manifest that matches the AgentSmith ASBCP image lock', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest());

    expect(checkAsbcpManifestLock({ manifestPath, lockPath })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects an empty release manifest instead of treating it like a missing read failure', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeFixture(root, 'asbcp-final-manifest.json', '');

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest');
    expect(failureText(result)).toContain('failed to parse');
  });

  it('rejects an empty ASBCP image lock instead of treating it like a missing read failure', () => {
    const root = tempRoot();
    const lockPath = writeFixture(root, 'asbcp-image.lock', '');
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest());

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('lock.asbcp_version');
    expect(failureText(result)).toContain('lock.asbcp_source_image');
  });

  it('rejects a manifest version/tag that does not match the lock version', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      version: 'v1.2.4',
      gitTag: 'v1.2.4',
      imageRef: `${CANONICAL_REPO}:v1.2.4@${DIGEST_A}`,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.version');
    expect(failureText(result)).toContain('v1.2.3');
    expect(failureText(result)).toContain('v1.2.4');
  });

  it('rejects a manifest with missing or mismatched final manifest schema identity', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const payload = manifest({
      manifestSchemaVersion: 'v2',
    });
    delete payload.schema_id;
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', payload);

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });
    const text = failureText(result);

    expect(result.ok).toBe(false);
    expect(text).toContain('manifest.schema_id');
    expect(text).toContain('manifest.manifest_schema_version');
    expect(text).toContain(SCHEMA_ID);
    expect(text).toContain(SCHEMA_VERSION);
  });

  it('rejects an unsupported ASBCP API contract version', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      apiContractVersion: 'v99',
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.api_contract_version');
    expect(failureText(result)).toContain('v99');
    expect(failureText(result)).toContain('supported');
  });

  it('rejects malformed structured known breaking changes', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      knownBreakingChanges: [
        {
          id: BREAKING_CHANGE_ID,
        },
      ],
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.known_breaking_changes[0].summary');
  });

  it('rejects a known breaking change that is not allowlisted by AgentSmith adoption policy', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      knownBreakingChanges: [
        {
          id: 'ASBCP-BC-9999',
          summary: 'unknown downstream breaking change',
        },
      ],
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.known_breaking_changes[0].id');
    expect(failureText(result)).toContain('ASBCP-BC-9999');
    expect(failureText(result)).toContain('allowlist');
  });

  it('allows known breaking changes by stable ID even when upstream summary wording drifts', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      knownBreakingChanges: [
        {
          id: BREAKING_CHANGE_ID,
          summary: 'same breaking change with refreshed release-note wording',
        },
      ],
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects a known breaking change whose AgentSmith allowlist entry has expired', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest());
    const policyPath = writeJsonFixture(root, 'asbcp-adoption-policy.json', policy({
      expiresOn: '2026-05-18',
    }));

    const result = checkAsbcpManifestLock({
      manifestPath,
      lockPath,
      policyPath,
      currentDate: '2026-05-19',
    });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.known_breaking_changes[0].id');
    expect(failureText(result)).toContain(BREAKING_CHANGE_ID);
    expect(failureText(result)).toContain('expired');
  });

  it('rejects a split-brain manifest when asbcp_version drifts but git_tag matches the lock', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      version: 'v9.9.9',
      gitTag: 'v1.2.3',
      imageRef: `${CANONICAL_REPO}:v1.2.3@${DIGEST_A}`,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.version');
    expect(failureText(result)).toContain('asbcp_version');
    expect(failureText(result)).toContain('git_tag');
  });

  it('rejects a manifest image digest that does not match the lock digest', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      imageRef: `${CANONICAL_REPO}:v1.2.3@${DIGEST_B}`,
      imageDigest: DIGEST_B,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });
    const text = failureText(result);

    expect(result.ok).toBe(false);
    expect(text).toContain('manifest.image_ref');
    expect(text).toContain('manifest.image_digest');
    expect(text).toContain(DIGEST_A);
    expect(text).toContain(DIGEST_B);
  });

  it('rejects a manifest whose nested digest evidence is not self-consistent', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      sameDigestProof: {
        tag_resolved_digest: DIGEST_A,
        build_push_digest: DIGEST_B,
        anonymous_digest: DIGEST_A,
        matches: true,
        source: 'fresh-empty Docker config docker pull image:tag and image:tag@build_push_digest',
      },
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.same_digest_proof.build_push_digest');
    expect(failureText(result)).toContain(DIGEST_A);
    expect(failureText(result)).toContain(DIGEST_B);
  });

  it('rejects a manifest whose anonymous pull tag does not match the release tag', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      anonymousPull: {
        result: 'ok',
        tag_ref: `${CANONICAL_REPO}:v9.9.9`,
        image_ref: `${CANONICAL_REPO}:v1.2.3@${DIGEST_A}`,
        tag_resolved_digest: DIGEST_A,
        build_push_digest: DIGEST_A,
        anonymous_digest: DIGEST_A,
        docker_config: 'fresh-empty',
        commands: [
          `DOCKER_CONFIG=<fresh-empty> docker pull ${CANONICAL_REPO}:v9.9.9`,
          `DOCKER_CONFIG=<fresh-empty> docker pull ${CANONICAL_REPO}:v1.2.3@${DIGEST_A}`,
        ],
      },
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.anonymous_pull.tag_ref');
    expect(failureText(result)).toContain('v1.2.3');
    expect(failureText(result)).toContain('v9.9.9');
  });

  it('rejects a manifest commit SHA that does not match the lock commit SHA', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      commitSha: COMMIT_B,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.commit_sha');
    expect(failureText(result)).toContain(COMMIT_A);
    expect(failureText(result)).toContain(COMMIT_B);
  });

  it('does not block P0 adoption when P2 release metadata is absent', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const payload = manifest();
    delete payload.known_risk_status_source;
    delete payload.runbook_url;
    delete payload.release_notes;
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', payload);

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('does not make runbook URL metadata consistency a P0 adoption blocker', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      runbookUrl: `https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/blob/${COMMIT_B}/docs/runbooks/release.md`,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('does not make known risk source or release notes metadata consistency a P0 adoption blocker', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      knownRiskStatusSource: 'p2-release-ledger-draft',
      releaseNotes: {
        body_source: 'draft release body',
        github_release_url: 'https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/v9.9.9',
      },
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects a manifest whose same_digest_proof.matches is false', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      sameDigestMatches: false,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.same_digest_proof.matches');
  });

  it('rejects CLI usage without an explicit authoritative manifest input', () => {
    const tsxCli = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const result = spawnSync(tsxCli, ['scripts/contracts/check-asbcp-manifest-lock.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ASBCP_FINAL_MANIFEST: '',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('manifest');
    expect(result.stderr).toContain('--manifest');
    expect(result.stderr).toContain('ASBCP_FINAL_MANIFEST');
  });

  it('accepts CLI manifest input from ASBCP_FINAL_MANIFEST for adoption script usage', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest());
    const policyPath = writeJsonFixture(root, 'asbcp-adoption-policy.json', policy());
    const tsxCli = join(process.cwd(), 'node_modules', '.bin', 'tsx');

    const result = spawnSync(tsxCli, [
      'scripts/contracts/check-asbcp-manifest-lock.ts',
      '--lock',
      lockPath,
      '--policy',
      policyPath,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ASBCP_FINAL_MANIFEST: manifestPath,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('passed');
  });

  it('rejects an ASBCP image lock that stores API contract version outside the release manifest', () => {
    const root = tempRoot();
    const lockPath = writeLock(root, {
      extraLines: ['api_contract_version=v1'],
    });
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest());

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('lock.api_contract_version');
    expect(failureText(result)).toContain('must not include');
  });

  it('rejects a manifest image outside the canonical ASBCP GHCR repository', () => {
    const root = tempRoot();
    const lockPath = writeLock(root);
    const manifestPath = writeJsonFixture(root, 'asbcp-final-manifest.json', manifest({
      imageRef: `ghcr.io/example/agentsmith-sandbox-control-plane:v1.2.3@${DIGEST_A}`,
    }));

    const result = checkAsbcpManifestLock({ manifestPath, lockPath });

    expect(result.ok).toBe(false);
    expect(failureText(result)).toContain('manifest.image_ref');
    expect(failureText(result)).toContain(CANONICAL_REPO);
  });
});
