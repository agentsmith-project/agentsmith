import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

type TsConfigShape = {
  include?: unknown;
};

type ContractStatus =
  | { kind: 'canonical' }
  | { kind: 'semantic_drift'; error: string }
  | { kind: 'transient_unreadable'; reason: string }
  | { kind: 'unexpected_io_failure'; reason: string };

const canonicalInclude = [
  '.next/types/**/*.ts',
  'next-env.d.ts',
  'src/**/*.ts',
  'src/**/*.tsx',
] as const;

const canonicalNextEnv = `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;

const forbiddenIncludePatterns = [
  {
    code: 'tsconfig_next_dist_include_must_use_canonical_root_next_types',
    pattern: /\.next\*\/types\/\*\*\/\*\.ts$/,
  },
  {
    code: 'tsconfig_next_dist_include_forbidden_live_lane_pointer',
    pattern: /(?:^|\/)artifacts\/(?:backend-real\/current-run|mock-lane\/current)\/next-dist(?:\/|$)/,
  },
  {
    code: 'tsconfig_next_dist_include_forbidden_local_manual',
    pattern: /(?:^|\/)\.next-local-manual-[^/]+\/types\/\*\*\/\*\.ts$/,
  },
  {
    code: 'tsconfig_next_dist_include_forbidden_recovery_manual',
    pattern: /(?:^|\/)artifacts\/recovery-manual-next(?:\/|$)/,
  },
  {
    code: 'tsconfig_next_dist_include_forbidden_playwright_managed',
    pattern: /playwright-managed-/,
  },
  {
    code: 'tsconfig_next_dist_include_forbidden_run_specific_next_dist',
    pattern: /(?:^|\/)artifacts\/[^/]+\/runs\/[^/]+\/next-dist(?:\/|$)/,
  },
] as const;

const forbiddenNextEnvPatterns = [
  /artifacts\/backend-real\/current-run\/next-dist\//,
  /artifacts\/mock-lane\/current\/next-dist\//,
  /\.next-local-manual-/,
  /artifacts\/recovery-manual-next/,
  /playwright-managed-/,
  /artifacts\/[^/\n]+\/runs\/[^/\n]+\/next-dist\//,
  /\/\/\/ <reference path=/,
] as const;

function parseRetryCount(raw: string | undefined, fallback: number): number {
  if (raw && /^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return fallback;
}

function parseRetryDelayMs(raw: string | undefined, fallback: number): number {
  if (raw && /^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return fallback;
}

function classifyReadError(error: unknown, prefix: string): ContractStatus {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';

  if (code === 'ENOENT' || code === 'EBUSY') {
    return {
      kind: 'transient_unreadable',
      reason: `${prefix}_${code.toLowerCase()}`,
    };
  }

  return {
    kind: 'unexpected_io_failure',
    reason: `${prefix}_${(code || 'unknown').toLowerCase()}`,
  };
}

function checkSourceContractOnce(): ContractStatus {
  let configRaw: string;
  try {
    configRaw = readFileSync('tsconfig.json', 'utf8');
  } catch (error) {
    return classifyReadError(error, 'tsconfig_read_failed');
  }

  let config: TsConfigShape;
  try {
    config = JSON.parse(configRaw) as TsConfigShape;
  } catch {
    return {
      kind: 'transient_unreadable',
      reason: 'tsconfig_json_parse_failed',
    };
  }

  const include = Array.isArray(config.include) ? config.include.filter((item): item is string => typeof item === 'string') : [];

  for (const entry of include) {
    for (const forbidden of forbiddenIncludePatterns) {
      if (forbidden.pattern.test(entry)) {
        return {
          kind: 'semantic_drift',
          error: `${forbidden.code}:${entry}`,
        };
      }
    }
  }

  if (include.length !== canonicalInclude.length || include.some((entry, index) => entry !== canonicalInclude[index])) {
    return {
      kind: 'semantic_drift',
      error: `tsconfig_next_dist_include_must_match_canonical:${JSON.stringify({
        expected: canonicalInclude,
        actual: include,
      })}`,
    };
  }

  let nextEnv: string | null = null;
  try {
    nextEnv = readFileSync('next-env.d.ts', 'utf8');
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (code === 'ENOENT') {
      return { kind: 'canonical' };
    }
    return classifyReadError(error, 'next_env_read_failed');
  }

  if (forbiddenNextEnvPatterns.some((pattern) => pattern.test(nextEnv))) {
    return {
      kind: 'semantic_drift',
      error: 'next_env_must_not_reference_lane_specific_types',
    };
  }
  if (nextEnv !== canonicalNextEnv) {
    return {
      kind: 'semantic_drift',
      error: 'next_env_must_match_canonical',
    };
  }

  return { kind: 'canonical' };
}

async function main(): Promise<void> {
  const retryCount = parseRetryCount(process.env.CHECK_NEXT_DIST_TYPES_RETRY_COUNT, 3);
  const retryDelayMs = parseRetryDelayMs(process.env.CHECK_NEXT_DIST_TYPES_RETRY_DELAY_MS, 50);
  let attempts = 1;

  while (true) {
    const result = checkSourceContractOnce();
    switch (result.kind) {
      case 'canonical':
        return;
      case 'semantic_drift':
        throw new Error(result.error);
      case 'unexpected_io_failure':
        throw new Error(`tsconfig_next_dist_contract_unexpected_io_failure:${result.reason}`);
      case 'transient_unreadable':
        if (attempts > retryCount) {
          throw new Error(`tsconfig_next_dist_contract_persistent_unreadable:${result.reason}`);
        }
        attempts += 1;
        await sleep(retryDelayMs);
        break;
      default: {
        const exhaustiveCheck: never = result;
        throw new Error(`tsconfig_next_dist_contract_unexpected_io_failure:${String(exhaustiveCheck)}`);
      }
    }
  }
}

main().catch((error) => {
  throw error;
});
