import { describe, expect, it } from 'vitest';

import {
  buildGovernancePureCheckShadowAuditForVerifyRun,
  buildGovernancePureCheckShadowAudit,
  PURE_CHECK_SHADOW_AUDIT_SCHEMA,
} from '../pure-check-shadow-audit';
import {
  CURRENT_PURE_CHECK_IDS,
  type CurrentPureCheckId,
} from '../current-pure-check-identity-manifest';

const DIGEST_INPUT = `sha256:${'1'.repeat(64)}`;
const DIGEST_ARTIFACT = `sha256:${'2'.repeat(64)}`;
const DIGEST_RESULT = `sha256:${'3'.repeat(64)}`;
const DIGEST_CLAIM = `sha256:${'4'.repeat(64)}`;

const FORBIDDEN_AUDIT_KEYS = new Set([
  'automated_release_verdict',
  'verdict',
  'release_verdict',
  'release_decision',
  'status',
  'exit_code',
  'cache_hit',
  'claim_reuse',
  'skip',
  'skipped',
  'producer',
  'owner',
  'env',
  'secret',
]);

function collectForbiddenKeys(value: unknown, path: string, matches: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenKeys(entry, `${path}[${index}]`, matches));
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_AUDIT_KEYS.has(key)) {
      matches.push(`${path}.${key}`);
    }
    collectForbiddenKeys(nested, `${path}.${key}`, matches);
  }
}

function expectNoForbiddenAuditKeys(value: unknown): void {
  const matches: string[] = [];

  collectForbiddenKeys(value, 'audit', matches);
  expect(matches).toEqual([]);
}

function checkById(
  audit: ReturnType<typeof buildGovernancePureCheckShadowAudit>,
  checkId: CurrentPureCheckId,
) {
  const check = audit.checks.find((candidate) => candidate.check_id === checkId);
  if (!check) {
    throw new Error(`missing audit check: ${checkId}`);
  }
  return check;
}

describe('pure check shadow audit projection', () => {
  it('projects shadow decisions and claim-store counts without release verdict or cache-hit semantics', () => {
    const audit = buildGovernancePureCheckShadowAudit({
      evaluations: [
        {
          check_id: 'contracts',
          decision: 'shadow_only',
          reason_codes: ['cache_policy_shadow_only'],
          claim_store_read: true,
          claim_store_write: false,
          claim_count: 2,
          valid_count: 1,
          invalid_count: 1,
        },
        {
          check_id: 'lint',
          decision: 'rerun_required',
          reason_codes: ['input_digest_mismatch'],
          claim_store_read: true,
          claim_store_write: false,
          claim_count: 1,
          valid_count: 0,
          invalid_count: 1,
        },
      ],
      generated_at: '2026-04-25T12:00:00.000Z',
    });

    expect(audit).toMatchObject({
      schema: PURE_CHECK_SHADOW_AUDIT_SCHEMA,
      audit_scope: 'pure_check_shadow_audit',
      summary_semantics: 'audit_only_not_release_verdict',
      cache_semantics: 'shadow_no_skip',
      claim_store_read: true,
      claim_store_write: false,
      claim_count: 3,
      valid_count: 1,
      invalid_count: 2,
    });
    expect(audit.checks.map((check) => check.check_id)).toEqual(CURRENT_PURE_CHECK_IDS);
    expect(checkById(audit, 'contracts')).toMatchObject({
      decision: 'shadow_only',
      would_reuse: false,
      reason_codes: ['cache_policy_shadow_only'],
      claim_store_read: true,
      claim_store_write: false,
      claim_count: 2,
      valid_count: 1,
      invalid_count: 1,
    });
    expect(checkById(audit, 'lint')).toMatchObject({
      decision: 'rerun_required',
      would_reuse: false,
      reason_codes: ['input_digest_mismatch'],
      claim_count: 1,
      valid_count: 0,
      invalid_count: 1,
    });
    expect(checkById(audit, 'unit')).toMatchObject({
      decision: 'rerun_required',
      would_reuse: false,
      reason_codes: ['pure_check_shadow_evaluation_not_available'],
      claim_store_read: false,
      claim_store_write: false,
      claim_count: 0,
      valid_count: 0,
      invalid_count: 0,
    });
    expect(JSON.stringify(audit)).not.toContain('cache_hit');
    expect(JSON.stringify(audit)).not.toContain('actual_skip');
    expectNoForbiddenAuditKeys(audit);
  });

  it('keeps optional digests under explicit audit scope and requires sha256 lowercase format', () => {
    const audit = buildGovernancePureCheckShadowAudit({
      evaluations: [
        {
          check_id: 'contracts',
          decision: 'reuse_allowed',
          reason_codes: ['pure_check_claim_valid_for_reuse'],
          claim_store_read: true,
          claim_store_write: true,
          claim_count: 1,
          valid_count: 1,
          invalid_count: 0,
          audit_digests: {
            input: DIGEST_INPUT,
            artifact: DIGEST_ARTIFACT,
            result: DIGEST_RESULT,
            claim: DIGEST_CLAIM,
          },
        },
      ],
      generated_at: '2026-04-25T12:00:00.000Z',
    });

    expect(checkById(audit, 'contracts')).toMatchObject({
      decision: 'shadow_only',
      would_reuse: true,
      reason_codes: ['pure_check_claim_valid_for_reuse', 'cache_policy_shadow_only'],
      claim_store_write: true,
    });
    expect(audit.claim_store_write).toBe(true);
    expect(checkById(audit, 'contracts').audit_digests).toEqual({
      scope: 'pure_check_shadow_audit',
      input: DIGEST_INPUT,
      artifact: DIGEST_ARTIFACT,
      result: DIGEST_RESULT,
      claim: DIGEST_CLAIM,
    });

    expect(() => buildGovernancePureCheckShadowAudit({
      evaluations: [
        {
          check_id: 'contracts',
          decision: 'shadow_only',
          reason_codes: ['cache_policy_shadow_only'],
          claim_store_read: true,
          claim_store_write: false,
          claim_count: 1,
          valid_count: 1,
          invalid_count: 0,
          audit_digests: {
            input: `sha256:${'A'.repeat(64)}`,
          },
        },
      ],
    })).toThrow('audit digest');
  });

  it('rejects audit projection inputs that would leak raw secrets or forbidden runtime semantics', () => {
    expect(() => buildGovernancePureCheckShadowAudit({
      evaluations: [
        {
          check_id: 'contracts',
          decision: 'shadow_only',
          reason_codes: ['Bearer sk-test-secret'],
          claim_store_read: true,
          claim_store_write: false,
          claim_count: 1,
          valid_count: 1,
          invalid_count: 0,
        },
      ],
    })).toThrow('secret-looking');

    expect(() => buildGovernancePureCheckShadowAudit({
      evaluations: [
        {
          check_id: 'contracts',
          decision: 'shadow_only',
          reason_codes: ['cache_policy_shadow_only'],
          claim_store_read: true,
          claim_store_write: false,
          claim_count: 1,
          valid_count: 1,
          invalid_count: 0,
          cache_hit: true,
        },
      ],
    } as Parameters<typeof buildGovernancePureCheckShadowAudit>[0])).toThrow('forbidden runtime/cache/verdict semantic');
  });

  it('rejects forbidden runtime semantics when used as reason code values', () => {
    for (const reasonCode of ['cache_hit', 'release_verdict'] as const) {
      expect(() => buildGovernancePureCheckShadowAudit({
        evaluations: [
          {
            check_id: 'contracts',
            decision: 'shadow_only',
            reason_codes: [reasonCode],
            claim_store_read: true,
            claim_store_write: false,
            claim_count: 1,
            valid_count: 1,
            invalid_count: 0,
          },
        ],
      })).toThrow('forbidden runtime/cache/verdict semantic');
    }
  });

  it('projects non-release verify-run coverage without inferring unit from gate default', () => {
    const audit = buildGovernancePureCheckShadowAuditForVerifyRun({
      executedScripts: ['verify:quick', 'verify:default', 'verify:visual'],
      generated_at: '2026-04-25T12:00:00.000Z',
    });

    expect(audit.checks.map((check) => check.check_id)).toEqual([
      'contracts',
      'openapi-contract',
      'openapi-generated',
      'lint',
      'typecheck',
    ]);
    expect(audit.checks.map((check) => check.check_id)).not.toContain('unit');
    expect(audit.checks.every((check) => check.decision === 'shadow_only')).toBe(true);
    expect(audit.checks.every((check) => check.would_reuse === false)).toBe(true);
    expect(audit.checks.every((check) => check.reason_codes.includes('producer_execution_confirmed_shadow_only'))).toBe(true);
    expect(audit.claim_store_read).toBe(false);
    expect(audit.claim_store_write).toBe(false);
  });
});
