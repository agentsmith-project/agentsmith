import { findCurrentGateDefinitionById } from './current-gate-manifest';
import { findCurrentJobMetadataById } from './current-job-metadata-manifest';

export const CURRENT_PURE_CHECK_IDENTITY_MANIFEST_SCHEMA = 'current-pure-check-identity-manifest.v1' as const;
export const CURRENT_PURE_CHECK_IDENTITY_MANIFEST_VERSION = 1 as const;

export const CURRENT_PURE_CHECK_IDS = [
  'contracts',
  'openapi-contract',
  'openapi-generated',
  'lint',
  'typecheck',
  'unit',
] as const;

export type CurrentPureCheckId = (typeof CURRENT_PURE_CHECK_IDS)[number];
export type CurrentPureCheckCachePolicy = 'shadow' | 'disabled';

export interface CurrentPureCheckInputDigestRule {
  id: string;
  description: string;
  material_policy: 'declared_path_globs_plus_toolchain';
  toolchain_inputs: readonly string[];
}

export interface CurrentPureCheckIdentity {
  check_id: CurrentPureCheckId;
  command: string;
  npm_script?: string;
  owning_gate_id: string;
  owning_job_id: string;
  path_globs: readonly string[];
  cache_policy: CurrentPureCheckCachePolicy;
  input_digest_rule_id: string;
}

export interface CurrentPureCheckIdentityManifest {
  schema: typeof CURRENT_PURE_CHECK_IDENTITY_MANIFEST_SCHEMA;
  version: typeof CURRENT_PURE_CHECK_IDENTITY_MANIFEST_VERSION;
  input_digest_rules: readonly CurrentPureCheckInputDigestRule[];
  checks: readonly CurrentPureCheckIdentity[];
}

export interface CurrentPureCheckIdentityManifestFailure {
  index: number;
  check_id?: string;
  path: string;
  reason: string;
}

export type CurrentPureCheckIdentityManifestValidationResult =
  | {
      ok: true;
      value: CurrentPureCheckIdentityManifest;
    }
  | {
      ok: false;
      failures: readonly CurrentPureCheckIdentityManifestFailure[];
    };

const TOP_LEVEL_FIELDS = ['schema', 'version', 'input_digest_rules', 'checks'] as const;
const DIGEST_RULE_FIELDS = ['id', 'description', 'material_policy', 'toolchain_inputs'] as const;
const CHECK_FIELDS = [
  'check_id',
  'command',
  'npm_script',
  'owning_gate_id',
  'owning_job_id',
  'path_globs',
  'cache_policy',
  'input_digest_rule_id',
] as const;
const CACHE_POLICIES = ['shadow', 'disabled'] as const satisfies readonly CurrentPureCheckCachePolicy[];
const FULL_REPO_PATH_GLOBS = new Set(['*', '**', '**/*', './**', './**/*', '.', './', '/']);
const FORBIDDEN_RUNTIME_FIELDS = new Set([
  'status',
  'exit_code',
  'failure_class',
  'started_at',
  'pid',
  'retry_count',
  'cache_hit',
  'claim_reuse',
  'verdict',
  'passed',
  'failed',
  'reusable',
  'claim_id',
  'input_digest',
  'artifact_digest',
  'result_digest',
]);
const TOP_LEVEL_FIELD_SET = new Set<string>(TOP_LEVEL_FIELDS);
const DIGEST_RULE_FIELD_SET = new Set<string>(DIGEST_RULE_FIELDS);
const CHECK_FIELD_SET = new Set<string>(CHECK_FIELDS);
const CACHE_POLICY_SET = new Set<string>(CACHE_POLICIES);
const CHECK_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const PURE_CHECK_INPUT_DIGEST_RULES = [
  {
    id: 'contracts-static-inputs-v1',
    description: 'Contracts check inputs are the declared governance, contract, workflow, story, and permission gate sources plus Node/npm toolchain identity.',
    material_policy: 'declared_path_globs_plus_toolchain',
    toolchain_inputs: ['node', 'npm', 'package-lock'],
  },
  {
    id: 'openapi-contract-static-inputs-v1',
    description: 'OpenAPI contract check inputs are the canonical OpenAPI specs, route-kind map, checker scripts, API route sources, and Node/npm toolchain identity.',
    material_policy: 'declared_path_globs_plus_toolchain',
    toolchain_inputs: ['node', 'npm', 'package-lock'],
  },
  {
    id: 'openapi-generated-static-inputs-v1',
    description: 'OpenAPI generated check inputs are the canonical OpenAPI YAML, generated type target, generator scripts, and Node/npm toolchain identity.',
    material_policy: 'declared_path_globs_plus_toolchain',
    toolchain_inputs: ['node', 'npm', 'package-lock'],
  },
  {
    id: 'lint-static-inputs-v1',
    description: 'Lint check inputs are source files, lint configuration, TypeScript configuration, and Node/npm toolchain identity.',
    material_policy: 'declared_path_globs_plus_toolchain',
    toolchain_inputs: ['node', 'npm', 'package-lock'],
  },
  {
    id: 'typecheck-static-inputs-v1',
    description: 'Typecheck inputs are TypeScript/React sources, generated API types, TypeScript/Next configuration, and Node/npm toolchain identity.',
    material_policy: 'declared_path_globs_plus_toolchain',
    toolchain_inputs: ['node', 'npm', 'package-lock', 'next-typegen'],
  },
  {
    id: 'unit-static-inputs-v1',
    description: 'Unit check inputs are Vitest specs, tested source trees, Vitest configuration, and Node/npm toolchain identity.',
    material_policy: 'declared_path_globs_plus_toolchain',
    toolchain_inputs: ['node', 'npm', 'package-lock'],
  },
] as const satisfies readonly CurrentPureCheckInputDigestRule[];

const CURRENT_PURE_CHECK_IDENTITIES = [
  {
    check_id: 'contracts',
    command: 'npm run contracts:check',
    npm_script: 'contracts:check',
    owning_gate_id: 'gate-fast',
    owning_job_id: 'standalone-gate-fast',
    path_globs: [
      'docs/contracts/**/*.md',
      'docs/contracts/**/*.json',
      'docs/contracts/**/*.yaml',
      'docs/testing/**/*.md',
      'docs/user-guides/**/*gate*.md',
      'scripts/contracts/**/*.ts',
      'scripts/governance/current-*.ts',
      'scripts/governance/sync-current-*.ts',
      'scripts/story-generated-spec.ts',
      '.github/workflows/contracts-check.yml',
      'package.json',
      'package-lock.json',
    ],
    cache_policy: 'shadow',
    input_digest_rule_id: 'contracts-static-inputs-v1',
  },
  {
    check_id: 'openapi-contract',
    command: 'npm run contracts:check-openapi',
    npm_script: 'contracts:check-openapi',
    owning_gate_id: 'gate-fast',
    owning_job_id: 'standalone-gate-fast',
    path_globs: [
      'docs/contracts/specs/openapi.yaml',
      'docs/contracts/specs/openapi.json',
      'docs/contracts/specs/openapi-route-kind-map.json',
      'scripts/contracts/check-openapi-*.ts',
      'packages/api-entry-node/src/**/*.ts',
      'src/lib/api/**/*.ts',
      'package.json',
      'package-lock.json',
    ],
    cache_policy: 'shadow',
    input_digest_rule_id: 'openapi-contract-static-inputs-v1',
  },
  {
    check_id: 'openapi-generated',
    command: 'npm run openapi:check-generated',
    npm_script: 'openapi:check-generated',
    owning_gate_id: 'gate-fast',
    owning_job_id: 'standalone-gate-fast',
    path_globs: [
      'docs/contracts/specs/openapi.yaml',
      'scripts/openapi/**/*.ts',
      'src/lib/api/types.generated.ts',
      'package.json',
      'package-lock.json',
    ],
    cache_policy: 'shadow',
    input_digest_rule_id: 'openapi-generated-static-inputs-v1',
  },
  {
    check_id: 'lint',
    command: 'npm run lint',
    npm_script: 'lint',
    owning_gate_id: 'gate-fast',
    owning_job_id: 'standalone-gate-fast',
    path_globs: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'scripts/**/*.ts',
      'packages/**/*.ts',
      'packages/**/*.tsx',
      'eslint.config.mjs',
      'tsconfig.json',
      'package.json',
      'package-lock.json',
    ],
    cache_policy: 'shadow',
    input_digest_rule_id: 'lint-static-inputs-v1',
  },
  {
    check_id: 'typecheck',
    command: 'npx tsc --noEmit',
    owning_gate_id: 'gate-fast',
    owning_job_id: 'standalone-gate-fast',
    path_globs: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'packages/**/*.ts',
      'packages/**/*.tsx',
      'scripts/**/*.ts',
      'docs/contracts/specs/openapi.yaml',
      'src/lib/api/types.generated.ts',
      'next-env.d.ts',
      'next.config.ts',
      'tsconfig.json',
      'package.json',
      'package-lock.json',
    ],
    cache_policy: 'shadow',
    input_digest_rule_id: 'typecheck-static-inputs-v1',
  },
  {
    check_id: 'unit',
    command: 'npm run test:run',
    npm_script: 'test:run',
    owning_gate_id: 'gate-default',
    owning_job_id: 'standalone-gate-default',
    path_globs: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'scripts/**/*.test.ts',
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
      'src/**/*.ts',
      'src/**/*.tsx',
      'scripts/**/*.ts',
      'packages/**/*.ts',
      'packages/**/*.tsx',
      'vitest.config.ts',
      'package.json',
      'package-lock.json',
    ],
    cache_policy: 'shadow',
    input_digest_rule_id: 'unit-static-inputs-v1',
  },
] as const satisfies readonly CurrentPureCheckIdentity[];

export const CURRENT_PURE_CHECK_IDENTITY_MANIFEST: CurrentPureCheckIdentityManifest = {
  schema: CURRENT_PURE_CHECK_IDENTITY_MANIFEST_SCHEMA,
  version: CURRENT_PURE_CHECK_IDENTITY_MANIFEST_VERSION,
  input_digest_rules: PURE_CHECK_INPUT_DIGEST_RULES,
  checks: CURRENT_PURE_CHECK_IDENTITIES,
};

export function listCurrentPureCheckIdentities(): readonly CurrentPureCheckIdentity[] {
  return CURRENT_PURE_CHECK_IDENTITY_MANIFEST.checks;
}

export function listCurrentPureCheckInputDigestRules(): readonly CurrentPureCheckInputDigestRule[] {
  return CURRENT_PURE_CHECK_IDENTITY_MANIFEST.input_digest_rules;
}

export function findCurrentPureCheckIdentityById(id: string): CurrentPureCheckIdentity | undefined {
  return CURRENT_PURE_CHECK_IDENTITY_MANIFEST.checks.find((check) => check.check_id === id);
}

export function validateCurrentPureCheckIdentityManifest(
  manifest: unknown = CURRENT_PURE_CHECK_IDENTITY_MANIFEST,
): CurrentPureCheckIdentityManifestValidationResult {
  const failures: CurrentPureCheckIdentityManifestFailure[] = [];

  validateForbiddenRuntimeFields(manifest, 'manifest', failures);
  if (!isRecord(manifest)) {
    return {
      ok: false,
      failures: [
        ...failures,
        {
          index: -1,
          path: 'manifest',
          reason: 'manifest must be an object.',
        },
      ],
    };
  }

  validateAllowedFields(manifest, TOP_LEVEL_FIELD_SET, 'top-level', 'manifest', -1, undefined, failures);
  if (manifest.schema !== CURRENT_PURE_CHECK_IDENTITY_MANIFEST_SCHEMA) {
    failures.push({
      index: -1,
      path: 'manifest.schema',
      reason: `schema must be ${CURRENT_PURE_CHECK_IDENTITY_MANIFEST_SCHEMA}.`,
    });
  }
  if (manifest.version !== CURRENT_PURE_CHECK_IDENTITY_MANIFEST_VERSION) {
    failures.push({
      index: -1,
      path: 'manifest.version',
      reason: `version must be ${String(CURRENT_PURE_CHECK_IDENTITY_MANIFEST_VERSION)}.`,
    });
  }
  if (!Array.isArray(manifest.input_digest_rules)) {
    failures.push({
      index: -1,
      path: 'manifest.input_digest_rules',
      reason: 'input_digest_rules must be an array.',
    });
  }
  if (!Array.isArray(manifest.checks)) {
    failures.push({
      index: -1,
      path: 'manifest.checks',
      reason: 'checks must be an array.',
    });
  }
  if (!Array.isArray(manifest.input_digest_rules) || !Array.isArray(manifest.checks)) {
    return {
      ok: false,
      failures,
    };
  }

  const inputDigestRuleIds = validateInputDigestRules(manifest.input_digest_rules, failures);
  validateChecks(manifest.checks, inputDigestRuleIds, failures);

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: manifest as CurrentPureCheckIdentityManifest,
  };
}

function validateInputDigestRules(
  rules: readonly unknown[],
  failures: CurrentPureCheckIdentityManifestFailure[],
): ReadonlySet<string> {
  const seenIds = new Set<string>();

  rules.forEach((rule, index) => {
    if (!isRecord(rule)) {
      failures.push({
        index,
        path: `input_digest_rules[${index}]`,
        reason: 'input digest rule must be an object.',
      });
      return;
    }

    validateAllowedFields(
      rule,
      DIGEST_RULE_FIELD_SET,
      'input digest rule',
      `input_digest_rules[${index}]`,
      index,
      typeof rule.id === 'string' ? rule.id : undefined,
      failures,
    );
    validateStableId(rule.id, 'input digest rule id', `input_digest_rules[${index}].id`, index, undefined, failures);
    if (typeof rule.id === 'string' && seenIds.has(rule.id)) {
      failures.push({
        index,
        check_id: rule.id,
        path: `input_digest_rules[${index}].id`,
        reason: `duplicate input_digest_rule id: ${rule.id}.`,
      });
    }
    if (typeof rule.id === 'string') {
      seenIds.add(rule.id);
    }
    validateRequiredString(rule.description, 'description', `input_digest_rules[${index}].description`, index, undefined, failures);
    if (rule.material_policy !== 'declared_path_globs_plus_toolchain') {
      failures.push({
        index,
        path: `input_digest_rules[${index}].material_policy`,
        reason: 'material_policy must be declared_path_globs_plus_toolchain.',
      });
    }
    validateNonEmptyStringArray(
      rule.toolchain_inputs,
      'toolchain_inputs',
      `input_digest_rules[${index}].toolchain_inputs`,
      index,
      typeof rule.id === 'string' ? rule.id : undefined,
      failures,
    );
  });

  return seenIds;
}

function validateChecks(
  checks: readonly unknown[],
  inputDigestRuleIds: ReadonlySet<string>,
  failures: CurrentPureCheckIdentityManifestFailure[],
): void {
  const seenIds = new Set<string>();

  checks.forEach((check, index) => {
    if (!isRecord(check)) {
      failures.push({
        index,
        path: `checks[${index}]`,
        reason: 'pure check identity must be an object.',
      });
      return;
    }

    const checkId = typeof check.check_id === 'string' ? check.check_id : undefined;

    validateAllowedFields(check, CHECK_FIELD_SET, 'pure check', `checks[${index}]`, index, checkId, failures);
    validateStableId(check.check_id, 'check_id', `checks[${index}].check_id`, index, checkId, failures);
    if (typeof check.check_id === 'string' && seenIds.has(check.check_id)) {
      failures.push({
        index,
        check_id: check.check_id,
        path: `checks[${index}].check_id`,
        reason: `duplicate check_id: ${check.check_id}.`,
      });
    }
    if (typeof check.check_id === 'string') {
      seenIds.add(check.check_id);
    }

    validateRequiredString(check.command, 'command', `checks[${index}].command`, index, checkId, failures);
    if ('npm_script' in check) {
      validateRequiredString(check.npm_script, 'npm_script', `checks[${index}].npm_script`, index, checkId, failures);
    }
    validateOwningGateAndJob(check, index, checkId, failures);
    validatePathGlobs(check.path_globs, index, checkId, failures);
    if (!CACHE_POLICY_SET.has(String(check.cache_policy))) {
      failures.push({
        index,
        check_id: checkId,
        path: `checks[${index}].cache_policy`,
        reason: 'cache_policy must be shadow or disabled.',
      });
    }
    if (typeof check.input_digest_rule_id !== 'string' || !inputDigestRuleIds.has(check.input_digest_rule_id)) {
      failures.push({
        index,
        check_id: checkId,
        path: `checks[${index}].input_digest_rule_id`,
        reason: 'unknown input_digest_rule_id.',
      });
    }
  });

  if (JSON.stringify([...seenIds]) !== JSON.stringify([...CURRENT_PURE_CHECK_IDS])) {
    failures.push({
      index: -1,
      path: 'checks',
      reason: 'checks must preserve the current pure check id order.',
    });
  }
}

function validateOwningGateAndJob(
  check: Record<string, unknown>,
  index: number,
  checkId: string | undefined,
  failures: CurrentPureCheckIdentityManifestFailure[],
): void {
  const owningGateId = typeof check.owning_gate_id === 'string' ? check.owning_gate_id : undefined;
  const owningJobId = typeof check.owning_job_id === 'string' ? check.owning_job_id : undefined;
  const gate = owningGateId ? findCurrentGateDefinitionById(owningGateId) : undefined;
  const job = owningJobId ? findCurrentJobMetadataById(owningJobId) : undefined;

  validateRequiredString(check.owning_gate_id, 'owning_gate_id', `checks[${index}].owning_gate_id`, index, checkId, failures);
  validateRequiredString(check.owning_job_id, 'owning_job_id', `checks[${index}].owning_job_id`, index, checkId, failures);
  if (owningGateId && !gate) {
    failures.push({
      index,
      check_id: checkId,
      path: `checks[${index}].owning_gate_id`,
      reason: `unknown owning_gate_id: ${owningGateId}.`,
    });
  }
  if (owningJobId && !job) {
    failures.push({
      index,
      check_id: checkId,
      path: `checks[${index}].owning_job_id`,
      reason: `unknown owning_job_id: ${owningJobId}.`,
    });
  }
  if (gate && job && job.gate_id !== gate.id) {
    failures.push({
      index,
      check_id: checkId,
      path: `checks[${index}].owning_job_id`,
      reason: 'owning_job_id must map to owning_gate_id.',
    });
  }
  if (job && job.kind !== 'standalone_gate') {
    failures.push({
      index,
      check_id: checkId,
      path: `checks[${index}].owning_job_id`,
      reason: 'pure check owner jobs must be standalone_gate jobs.',
    });
  }
}

function validatePathGlobs(
  value: unknown,
  index: number,
  checkId: string | undefined,
  failures: CurrentPureCheckIdentityManifestFailure[],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    failures.push({
      index,
      check_id: checkId,
      path: `checks[${index}].path_globs`,
      reason: 'path_globs must be non-empty.',
    });
    return;
  }

  const seenGlobs = new Set<string>();

  value.forEach((glob, globIndex) => {
    if (typeof glob !== 'string' || glob.trim() === '') {
      failures.push({
        index,
        check_id: checkId,
        path: `checks[${index}].path_globs[${globIndex}]`,
        reason: 'path_globs entries must be non-empty strings.',
      });
      return;
    }
    if (glob !== glob.trim()) {
      failures.push({
        index,
        check_id: checkId,
        path: `checks[${index}].path_globs[${globIndex}]`,
        reason: 'path_globs entries must not contain leading or trailing whitespace.',
      });
    }
    if (FULL_REPO_PATH_GLOBS.has(glob)) {
      failures.push({
        index,
        check_id: checkId,
        path: `checks[${index}].path_globs[${globIndex}]`,
        reason: 'path_globs must not generalize to the full repo.',
      });
    }
    if (glob.startsWith('/') || glob.startsWith('../') || glob.includes('/../')) {
      failures.push({
        index,
        check_id: checkId,
        path: `checks[${index}].path_globs[${globIndex}]`,
        reason: 'path_globs must be repo-relative and stay inside the repo.',
      });
    }
    if (seenGlobs.has(glob)) {
      failures.push({
        index,
        check_id: checkId,
        path: `checks[${index}].path_globs[${globIndex}]`,
        reason: `duplicate path_globs entry: ${glob}.`,
      });
    }
    seenGlobs.add(glob);
  });
}

function validateStableId(
  value: unknown,
  label: string,
  path: string,
  index: number,
  checkId: string | undefined,
  failures: CurrentPureCheckIdentityManifestFailure[],
): void {
  if (typeof value !== 'string' || !CHECK_ID_PATTERN.test(value)) {
    failures.push({
      index,
      check_id: checkId,
      path,
      reason: `${label} must be non-empty stable kebab-case.`,
    });
  }
}

function validateRequiredString(
  value: unknown,
  label: string,
  path: string,
  index: number,
  checkId: string | undefined,
  failures: CurrentPureCheckIdentityManifestFailure[],
): void {
  if (typeof value !== 'string' || value.trim() === '') {
    failures.push({
      index,
      check_id: checkId,
      path,
      reason: `${label} must be a non-empty string.`,
    });
  }
}

function validateNonEmptyStringArray(
  value: unknown,
  label: string,
  path: string,
  index: number,
  checkId: string | undefined,
  failures: CurrentPureCheckIdentityManifestFailure[],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    failures.push({
      index,
      check_id: checkId,
      path,
      reason: `${label} must be a non-empty array.`,
    });
    return;
  }
  value.forEach((entry, entryIndex) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      failures.push({
        index,
        check_id: checkId,
        path: `${path}[${entryIndex}]`,
        reason: `${label} entries must be non-empty strings.`,
      });
    }
  });
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  label: string,
  path: string,
  index: number,
  checkId: string | undefined,
  failures: CurrentPureCheckIdentityManifestFailure[],
): void {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      failures.push({
        index,
        check_id: checkId,
        path: `${path}.${field}`,
        reason: `unknown ${label} field "${field}".`,
      });
    }
  }
}

function validateForbiddenRuntimeFields(
  value: unknown,
  path: string,
  failures: CurrentPureCheckIdentityManifestFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateForbiddenRuntimeFields(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [field, nested] of Object.entries(value)) {
    if (FORBIDDEN_RUNTIME_FIELDS.has(field)) {
      failures.push({
        index: -1,
        path: `${path}.${field}`,
        reason: `forbidden runtime field "${field}".`,
      });
    }
    validateForbiddenRuntimeFields(nested, `${path}.${field}`, failures);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
