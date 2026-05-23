import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FORBIDDEN_RUNNER_REPO,
  RELEASE_KIT_CANONICAL_REPO,
  RUNNER_CANONICAL_REPO,
  normalizeReleaseBoundaryRemote,
} from '../governance/current-release-boundary-schema';

export {
  FORBIDDEN_RUNNER_REPO,
  RELEASE_KIT_CANONICAL_REPO,
  RUNNER_CANONICAL_REPO,
};

export type RepoSplitBootstrapMode = 'local' | 'ci';
export type RepoSplitBootstrapRepo = 'release-kit' | 'runner' | 'runner-migration';
export type RepoSplitBootstrapStatus = 'canonical' | 'migration_input';

export type RepoSplitBootstrapFailure = {
  path: string;
  reason: string;
};

export type RepoSplitBootstrapInput = {
  mode: RepoSplitBootstrapMode | string;
  repo: RepoSplitBootstrapRepo | string;
  repoPath?: string;
  remoteUrl?: string;
  workspaceParent?: string;
};

export type RepoSplitBootstrapPassResult = {
  ok: true;
  mode: RepoSplitBootstrapMode;
  repo: RepoSplitBootstrapRepo;
  status: RepoSplitBootstrapStatus;
  repo_name: string;
  normalized_remote: string;
  canonical_repo?: string;
  migration_to?: string;
  repo_path?: string;
};

export type RepoSplitBootstrapFailResult = {
  ok: false;
  status: 'failed';
  failures: readonly RepoSplitBootstrapFailure[];
};

export type RepoSplitBootstrapResult =
  | RepoSplitBootstrapPassResult
  | RepoSplitBootstrapFailResult;

type RepoSpec = {
  repo: RepoSplitBootstrapRepo;
  repoName: string;
  expectedRemote: string;
  status: RepoSplitBootstrapStatus;
  migrationTo?: string;
};

const DEFAULT_WORKSPACE_PARENT = '/home/percy/works/mbos-v1';
const AGENTSMITH_REPO_NAME = 'agentsmith';
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

const REPO_SPECS: Record<RepoSplitBootstrapRepo, RepoSpec> = {
  'release-kit': {
    repo: 'release-kit',
    repoName: 'agentsmith-release-kit',
    expectedRemote: RELEASE_KIT_CANONICAL_REPO,
    status: 'canonical',
  },
  runner: {
    repo: 'runner',
    repoName: 'agentsmith-runner',
    expectedRemote: RUNNER_CANONICAL_REPO,
    status: 'canonical',
  },
  'runner-migration': {
    repo: 'runner-migration',
    repoName: 'agentsmith-codex-runner',
    expectedRemote: FORBIDDEN_RUNNER_REPO,
    status: 'migration_input',
    migrationTo: RUNNER_CANONICAL_REPO,
  },
};

function failure(path: string, reason: string): RepoSplitBootstrapFailure {
  return { path, reason };
}

function failed(failures: readonly RepoSplitBootstrapFailure[]): RepoSplitBootstrapFailResult {
  return {
    ok: false,
    status: 'failed',
    failures,
  };
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const childRelativePath = relative(parentPath, childPath);
  return childRelativePath.length > 0
    && !childRelativePath.startsWith('..')
    && !isAbsolute(childRelativePath);
}

function getRepoSpec(repo: string): RepoSpec | null {
  if (repo === 'release-kit' || repo === 'runner' || repo === 'runner-migration') {
    return REPO_SPECS[repo];
  }

  return null;
}

function normalizeMode(mode: string): RepoSplitBootstrapMode | null {
  if (mode === 'local' || mode === 'ci') {
    return mode;
  }

  return null;
}

function normalizeGitHubRepositoryIdentity(githubRepository: string): string | null {
  const trimmed = githubRepository.trim();
  if (!GITHUB_REPOSITORY_PATTERN.test(trimmed)) {
    return null;
  }

  return `github.com/${trimmed}`;
}

function validateLocalPath(
  repoPath: string | undefined,
  spec: RepoSpec,
  workspaceParent: string,
): { ok: true; repoPath: string } | RepoSplitBootstrapFailResult {
  if (repoPath === undefined || repoPath.trim().length === 0) {
    return failed([failure('repoPath', 'repoPath is required for local repo split bootstrap validation.')]);
  }

  const normalizedRepoPath = resolve(repoPath);
  const normalizedWorkspaceParent = resolve(workspaceParent);
  const agentsmithRepoPath = join(normalizedWorkspaceParent, AGENTSMITH_REPO_NAME);

  if (normalizedRepoPath === agentsmithRepoPath || isPathInside(normalizedRepoPath, agentsmithRepoPath)) {
    return failed([failure('repoPath', 'repoPath must be a sibling of agentsmith, not nested under agentsmith.')]);
  }

  if (dirname(normalizedRepoPath) !== normalizedWorkspaceParent) {
    return failed([failure('repoPath', `repoPath parent must be ${normalizedWorkspaceParent}.`)]);
  }

  if (basename(normalizedRepoPath) !== spec.repoName) {
    if (spec.repo === 'runner' && basename(normalizedRepoPath) === 'agentsmith-codex-runner') {
      return failed([
        failure(
          'repoPath',
          'agentsmith-codex-runner is migration_input only and must not be used as canonical runner bootstrap.',
        ),
      ]);
    }

    return failed([failure('repoPath', `repoPath basename must be ${spec.repoName}.`)]);
  }

  return { ok: true, repoPath: normalizedRepoPath };
}

export function validateRepoSplitBootstrap(input: RepoSplitBootstrapInput): RepoSplitBootstrapResult {
  const failures: RepoSplitBootstrapFailure[] = [];
  const mode = normalizeMode(input.mode);
  const spec = getRepoSpec(input.repo);

  if (mode === null) {
    failures.push(failure('mode', 'mode must be local or ci.'));
  }
  if (spec === null) {
    failures.push(failure('repo', 'repo must be release-kit, runner, or runner-migration.'));
  }
  if (failures.length > 0 || mode === null || spec === null) {
    return failed(failures);
  }

  let repoPath: string | undefined;
  if (mode === 'local') {
    const pathResult = validateLocalPath(
      input.repoPath,
      spec,
      input.workspaceParent ?? DEFAULT_WORKSPACE_PARENT,
    );
    if (!pathResult.ok) {
      return pathResult;
    }
    repoPath = pathResult.repoPath;
  }

  if (input.remoteUrl === undefined || input.remoteUrl.trim().length === 0) {
    return failed([failure('remoteUrl', 'remoteUrl is required for repo split bootstrap validation.')]);
  }

  const normalizedRemote = normalizeReleaseBoundaryRemote(input.remoteUrl);
  if (normalizedRemote === null) {
    return failed([failure('remoteUrl', 'remoteUrl must be a GitHub HTTPS or SSH origin.')]);
  }

  if (normalizedRemote !== spec.expectedRemote) {
    if (spec.repo === 'runner' && normalizedRemote === FORBIDDEN_RUNNER_REPO) {
      return failed([
        failure(
          'remoteUrl',
          'agentsmith-codex-runner is migration_input only and must not be used as canonical runner bootstrap.',
        ),
      ]);
    }

    const reason = spec.repo === 'runner-migration'
      ? `migration input must be ${FORBIDDEN_RUNNER_REPO} with status migration_input.`
      : `normalized repo identity must be ${spec.expectedRemote}.`;
    return failed([failure('remoteUrl', reason)]);
  }

  return {
    ok: true,
    mode,
    repo: spec.repo,
    status: spec.status,
    repo_name: spec.repoName,
    normalized_remote: normalizedRemote,
    canonical_repo: spec.status === 'canonical' ? spec.expectedRemote : undefined,
    migration_to: spec.migrationTo,
    repo_path: repoPath,
  };
}

type CliInput = RepoSplitBootstrapInput;

function parseArgv(argv: readonly string[]): { ok: true; value: CliInput } | RepoSplitBootstrapFailResult {
  const values = new Map<string, string>();
  const failures: RepoSplitBootstrapFailure[] = [];
  const allowedKeys = new Set(['mode', 'repo', 'repo-path', 'remote-url', 'workspace-parent']);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      failures.push(failure('argv', `unexpected positional argument "${arg}".`));
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    const key = equalsIndex >= 0 ? withoutPrefix.slice(0, equalsIndex) : withoutPrefix;
    const inlineValue = equalsIndex >= 0 ? withoutPrefix.slice(equalsIndex + 1) : undefined;

    if (!allowedKeys.has(key)) {
      failures.push(failure('argv', `unknown option --${key}.`));
      continue;
    }

    if (inlineValue !== undefined) {
      values.set(key, inlineValue);
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue === undefined || nextValue.startsWith('--')) {
      failures.push(failure('argv', `--${key} requires a value.`));
      continue;
    }

    values.set(key, nextValue);
    index += 1;
  }

  if (failures.length > 0) {
    return failed(failures);
  }

  return {
    ok: true,
    value: {
      mode: values.get('mode') ?? 'local',
      repo: values.get('repo') ?? '',
      repoPath: values.get('repo-path'),
      remoteUrl: values.get('remote-url'),
      workspaceParent: values.get('workspace-parent'),
    },
  };
}

function readOriginRemote(repoPath: string): string | null {
  try {
    return execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function readGitTopLevel(repoPath: string): string | null {
  try {
    return execFileSync('git', ['-C', repoPath, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function validateCiGitHubRepositoryIdentity(input: CliInput): RepoSplitBootstrapFailResult | null {
  const githubRepository = process.env.GITHUB_REPOSITORY;
  if (githubRepository === undefined) {
    return null;
  }

  const spec = getRepoSpec(input.repo);
  if (spec === null) {
    return null;
  }

  const normalizedGitHubRepository = normalizeGitHubRepositoryIdentity(githubRepository);
  if (normalizedGitHubRepository === null) {
    return failed([
      failure(
        'GITHUB_REPOSITORY',
        'GITHUB_REPOSITORY must use owner/repo format for CI repo split bootstrap validation.',
      ),
    ]);
  }

  if (normalizedGitHubRepository !== spec.expectedRemote) {
    return failed([
      failure(
        'GITHUB_REPOSITORY',
        `GITHUB_REPOSITORY must match ${spec.expectedRemote} for repo=${spec.repo} and cannot be overridden by --remote-url.`,
      ),
    ]);
  }

  return null;
}

export function checkRepoSplitBootstrapCli(input: CliInput): RepoSplitBootstrapResult {
  const mode = normalizeMode(input.mode);

  if (mode === 'local') {
    if (input.repoPath === undefined || input.repoPath.trim().length === 0) {
      return failed([failure('repoPath', 'repoPath is required for local repo split bootstrap validation.')]);
    }

    const resolvedRepoPath = resolve(input.repoPath);
    if (!existsSync(resolvedRepoPath)) {
      return failed([failure('repoPath', 'repoPath must exist before bootstrap validation can read origin.')]);
    }

    if (!statSync(resolvedRepoPath).isDirectory()) {
      return failed([failure('repoPath', 'repoPath must be a directory.')]);
    }

    const repoPath = realpathSync(resolvedRepoPath);
    const gitTopLevel = readGitTopLevel(repoPath);
    if (gitTopLevel === null || gitTopLevel.length === 0) {
      return failed([failure('repoPath', 'repoPath must be a git repository.')]);
    }

    const realGitTopLevel = realpathSync(gitTopLevel);
    if (realGitTopLevel !== repoPath) {
      return failed([failure('repoPath', 'repoPath must be the git repository top-level.')]);
    }

    const remoteUrl = readOriginRemote(repoPath);
    if (remoteUrl === null || remoteUrl.trim().length === 0) {
      return failed([failure('remoteUrl', 'origin remote is required for local repo split bootstrap validation.')]);
    }

    if (input.remoteUrl !== undefined) {
      const expectedRemote = normalizeReleaseBoundaryRemote(input.remoteUrl);
      if (expectedRemote === null) {
        return failed([failure('remoteUrl', 'remoteUrl must be a GitHub HTTPS or SSH origin.')]);
      }

      const actualRemote = normalizeReleaseBoundaryRemote(remoteUrl);
      if (actualRemote === null) {
        return failed([failure('remoteUrl', 'origin remote must be a GitHub HTTPS or SSH origin.')]);
      }

      if (expectedRemote !== actualRemote) {
        return failed([failure('remoteUrl', 'remote-url must match the actual origin remote after normalization.')]);
      }
    }

    return validateRepoSplitBootstrap({
      ...input,
      mode,
      repoPath,
      remoteUrl,
    });
  }

  if (mode === 'ci') {
    const githubRepositoryResult = validateCiGitHubRepositoryIdentity(input);
    if (githubRepositoryResult !== null) {
      return githubRepositoryResult;
    }
  }

  return validateRepoSplitBootstrap(input);
}

function formatFailure(item: RepoSplitBootstrapFailure): string {
  return `- ${item.path}: ${item.reason}`;
}

function main(): void {
  const parsed = parseArgv(process.argv.slice(2));
  const result = parsed.ok ? checkRepoSplitBootstrapCli(parsed.value) : parsed;

  if (!result.ok) {
    console.error('[contracts] repo split bootstrap check failed:');
    for (const item of result.failures) {
      console.error(formatFailure(item));
    }
    process.exit(1);
  }

  console.log(
    `[contracts] repo split bootstrap check passed: ${result.repo_name} ${result.status} ${result.normalized_remote}`,
  );
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedModulePath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);

if (currentModulePath === invokedModulePath) {
  main();
}
