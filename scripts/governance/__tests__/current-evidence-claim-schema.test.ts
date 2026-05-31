import { describe, expect, it } from 'vitest';

import {
  CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
  type CurrentEvidenceClaimRecord,
  validateCurrentEvidenceClaim,
} from '../current-evidence-claim-schema';

const DIGEST_1 = `sha256:${'1'.repeat(64)}`;
const DIGEST_2 = `sha256:${'2'.repeat(64)}`;
const DIGEST_3 = `sha256:${'3'.repeat(64)}`;
const DIGEST_4 = `sha256:${'4'.repeat(64)}`;

type ClaimFixture = Record<string, unknown>;
type ClaimFixtureOverrides =
  & Partial<Record<keyof CurrentEvidenceClaimRecord, unknown>>
  & Record<string, unknown>;

function makeLocalClaim(
  overrides: ClaimFixtureOverrides = {},
): ClaimFixture {
  return {
    schema_version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
    subject: 'visual.full_catalog',
    scope: 'visual',
    campaign_id: null,
    campaign_root: null,
    run_id: null,
    step_id: null,
    check_id: null,
    gate_id: 'lane-visual',
    line_kind: 'visual',
    gate_adapter: {
      npm_script: 'lane:visual',
    },
    evidence_dir: 'artifacts/visual-baseline-reviews/local-run',
    result_status: 'passed',
    failure_class: 'none',
    input_digest: {
      value: DIGEST_1,
    },
    artifact_digest: {
      value: DIGEST_2,
    },
    result_digest: DIGEST_3,
    producer: {
      origin: 'local',
    },
    freshness: {
      git_sha: 'abc1234',
      allow_cross_commit: false,
      allow_cross_secret_profile: false,
      secret_profile_digest: null,
    },
    validator: {
      name: 'current-evidence-claim-schema',
      version: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
    },
    generated_at: '2026-04-25T12:00:00.000Z',
    ...overrides,
  };
}

function makeReleaseClaim(
  overrides: ClaimFixtureOverrides = {},
): ClaimFixture {
  return makeLocalClaim({
    subject: 'release.visual.full_catalog',
    scope: 'release',
    campaign_id: 'release-full',
    campaign_root: 'artifacts/release-runs/release-run-001',
    run_id: 'release-run-001',
    step_id: 'lane-visual',
    check_id: null,
    evidence_dir: 'artifacts/release-runs/release-run-001/lane-visual',
    freshness: {
      git_sha: 'abc1234',
      allow_cross_commit: false,
      allow_cross_secret_profile: false,
      secret_profile_digest: DIGEST_4,
    },
    ...overrides,
  });
}

function makePureCheckClaim(
  overrides: ClaimFixtureOverrides = {},
): ClaimFixture {
  return makeLocalClaim({
    subject: 'pure.gate_fast',
    scope: 'debug',
    check_id: 'contracts',
    gate_id: 'gate-fast',
    line_kind: 'governance_run_quick',
    gate_adapter: {
      npm_script: 'contracts:check',
    },
    evidence_dir: 'artifacts/governance-runner-shell-plan/local-run/standalone-gate-fast',
    ...overrides,
  });
}

function expectInvalid(claim: unknown): void {
  const result = validateCurrentEvidenceClaim(claim, { purpose: 'record' });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures.length).toBeGreaterThan(0);
  }
}

describe('current evidence claim schema', () => {
  it('passes a valid local record claim with campaign fields null', () => {
    const result = validateCurrentEvidenceClaim(makeLocalClaim(), { purpose: 'record' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        campaign_id: null,
        campaign_root: null,
        run_id: null,
        step_id: null,
        check_id: null,
        gate_id: 'lane-visual',
        result_status: 'passed',
        failure_class: 'none',
      },
    });
  });

  it('passes a valid release claim only with explicit release-full binding', () => {
    expect(validateCurrentEvidenceClaim(makeReleaseClaim(), { purpose: 'record' }).ok).toBe(true);

    expectInvalid(makeReleaseClaim({ campaign_id: null }));
    expectInvalid(makeReleaseClaim({ campaign_id: 'release-candidate' }));
  });

  it('fails when input, artifact, or result digests are missing or malformed', () => {
    expectInvalid({
      ...makeLocalClaim(),
      input_digest: {},
    });
    expectInvalid({
      ...makeLocalClaim(),
      artifact_digest: {
        value: `sha256:${'A'.repeat(64)}`,
      },
    });
    expectInvalid({
      ...makeLocalClaim(),
      result_digest: null,
    });
  });

  it('fails unknown or missing gate_id for verdict_candidate validation', () => {
    expect(validateCurrentEvidenceClaim(
      makeLocalClaim({ gate_id: 'unknown-gate' }),
      { purpose: 'verdict_candidate' },
    ).ok).toBe(false);

    const { gate_id: _gateId, ...missingGateId } = makeLocalClaim();

    expect(validateCurrentEvidenceClaim(missingGateId, { purpose: 'verdict_candidate' }).ok)
      .toBe(false);
  });

  it('fails when gate_adapter.npm_script does not match the current context', () => {
    expectInvalid(makeLocalClaim({
      gate_adapter: {
        npm_script: 'test:visual',
      },
    }));

    expectInvalid(makeReleaseClaim({
      gate_adapter: {
        npm_script: 'gate:release',
      },
    }));
  });

  it('fails release claims with missing or mismatched campaign topology', () => {
    expectInvalid(makeReleaseClaim({ campaign_root: null }));
    expectInvalid(makeReleaseClaim({ run_id: null }));
    expectInvalid(makeReleaseClaim({ step_id: null }));
    expectInvalid(makeReleaseClaim({ campaign_root: 'artifacts/release-runs/other-run' }));
    expectInvalid(makeReleaseClaim({ step_id: 'gate-default' }));
    expectInvalid(makeReleaseClaim({ step_id: 'unknown-step' }));
  });

  it('passes release verdict candidates with absolute campaign and evidence paths', () => {
    const result = validateCurrentEvidenceClaim(
      makeReleaseClaim({
        campaign_root: '/tmp/agentsmith/artifacts/release-runs/release-run-001',
        evidence_dir: '/tmp/agentsmith/artifacts/release-runs/release-run-001/lane-visual',
      }),
      { purpose: 'verdict_candidate' },
    );

    expect(result.ok).toBe(true);
  });

  it('fails release verdict candidates when evidence_dir points outside the campaign step', () => {
    const result = validateCurrentEvidenceClaim(
      makeReleaseClaim({
        evidence_dir: 'artifacts/release-runs/release-run-001/other-step',
      }),
      { purpose: 'verdict_candidate' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures).toContainEqual(expect.objectContaining({
        path: 'evidence_dir',
        code: 'release_step_evidence_dir_mismatch',
      }));
    }
  });

  it('allows a failed claim as a record but rejects it for reuse and verdict_candidate', () => {
    const failedClaim = makeLocalClaim({
      result_status: 'failed',
      failure_class: 'product_regression',
    });

    expect(validateCurrentEvidenceClaim(failedClaim, { purpose: 'record' }).ok).toBe(true);
    expect(validateCurrentEvidenceClaim(failedClaim, { purpose: 'reuse' }).ok).toBe(false);
    expect(validateCurrentEvidenceClaim(failedClaim, { purpose: 'verdict_candidate' }).ok)
      .toBe(false);
  });

  it('requires stable check_id binding for pure check reuse claims only', () => {
    expect(validateCurrentEvidenceClaim(
      makePureCheckClaim(),
      { purpose: 'pure_check_reuse' },
    ).ok).toBe(true);

    const missingCheckId = validateCurrentEvidenceClaim(
      makePureCheckClaim({ check_id: null }),
      { purpose: 'pure_check_reuse' },
    );
    const releasePureReuse = validateCurrentEvidenceClaim(
      makeReleaseClaim({ check_id: 'contracts' }),
      { purpose: 'pure_check_reuse' },
    );

    expect(missingCheckId.ok).toBe(false);
    if (!missingCheckId.ok) {
      expect(missingCheckId.failures).toContainEqual(expect.objectContaining({
        path: 'check_id',
        code: 'pure_check_id_required',
      }));
    }
    expect(releasePureReuse.ok).toBe(false);
    if (!releasePureReuse.ok) {
      expect(releasePureReuse.failures).toContainEqual(expect.objectContaining({
        path: 'scope',
        code: 'pure_check_release_scope_not_allowed',
      }));
    }
  });

  it('fails invalid result status and failure_class pairings', () => {
    expectInvalid(makeLocalClaim({
      result_status: 'passed',
      failure_class: 'product_regression',
    }));
    expectInvalid(makeLocalClaim({
      result_status: 'failed',
      failure_class: 'none',
    }));
  });

  it('fails backend-real and release claims without same secret profile binding', () => {
    expectInvalid(makeLocalClaim({
      scope: 'real',
      gate_id: 'lane-backend-real-core',
      line_kind: 'backend_real',
      gate_adapter: {
        npm_script: 'lane:backend-real:core',
      },
    }));

    expectInvalid(makeLocalClaim({
      scope: 'real',
      gate_id: 'lane-backend-real-core',
      line_kind: 'backend_real',
      gate_adapter: {
        npm_script: 'lane:backend-real:core',
      },
      freshness: {
        git_sha: 'abc1234',
        allow_cross_commit: false,
        allow_cross_secret_profile: true,
        secret_profile_digest: DIGEST_4,
      },
    }));

    expectInvalid(makeReleaseClaim({
      freshness: {
        git_sha: 'abc1234',
        allow_cross_commit: false,
        allow_cross_secret_profile: false,
        secret_profile_digest: null,
      },
    }));
  });

  it('fails secret-looking strings in the claim payload', () => {
    for (const secretLikeValue of [
      'Bearer cleartext-token',
      'api_key=cleartext',
      'access_token=cleartext',
      'refresh_token=cleartext',
      'oauth_token=cleartext',
      'client_secret=cleartext',
      'password=cleartext',
      'ticket=cleartext',
      'managed_credentials.provider',
      'sk-1234567890abcdef',
    ]) {
      expectInvalid(makeLocalClaim({ subject: secretLikeValue }));
    }
  });

  it('fails unknown top-level keys, camelCase top-level keys, and schema version drift', () => {
    expectInvalid({
      ...makeLocalClaim(),
      extra_key: 'not allowed',
    });
    expectInvalid({
      ...makeLocalClaim(),
      schemaVersion: CURRENT_EVIDENCE_CLAIM_SCHEMA_VERSION,
    });
    expectInvalid(makeLocalClaim({ schema_version: '2.0.0' }));
  });
});
