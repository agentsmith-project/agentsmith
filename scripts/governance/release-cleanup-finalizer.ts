import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export type ReleaseCleanupReason = 'success' | 'failure' | 'interrupted';

export type ReleaseCleanupResource =
  | 'unified_substrate'
  | 'integration_deps'
  | 'kind_cluster'
  | 'kind_registry';

export type ReleaseCleanupProbePhase = 'before' | 'after';

export interface ReleaseCleanupCommand {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface ReleaseCleanupCommandResult {
  status: number | null;
  signal: NodeJS.Signals | null;
}

export type ReleaseCleanupCommandRunner = (
  command: ReleaseCleanupCommand,
) => ReleaseCleanupCommandResult;

export type ReleaseCleanupResourceProbe = (
  resource: ReleaseCleanupResource,
  phase: ReleaseCleanupProbePhase,
) => boolean;

export interface ReleaseCleanupFinalizer {
  finalize: (reason: ReleaseCleanupReason) => void;
}

export interface CreateReleaseCleanupFinalizerInput {
  cwd: string;
  env: NodeJS.ProcessEnv;
  campaignRoot: string;
  probeResource?: ReleaseCleanupResourceProbe;
  cleanupRunner?: ReleaseCleanupCommandRunner;
}

const CLEANUP_RESOURCES = [
  'unified_substrate',
  'integration_deps',
  'kind_cluster',
  'kind_registry',
] as const satisfies readonly ReleaseCleanupResource[];

const DISABLED_CLEANUP_VALUES = new Set(['0', 'false', 'off', 'no', 'skip', 'disabled']);

function defaultCleanupRunner(command: ReleaseCleanupCommand): ReleaseCleanupCommandResult {
  const result = spawnSync(command.executable, [...command.args], {
    cwd: command.cwd,
    env: command.env,
    stdio: 'ignore',
  });
  return {
    status: result.status,
    signal: result.signal,
  };
}

function commandOutput(input: {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): string {
  const result = spawnSync(input.executable, [...input.args], {
    cwd: input.cwd,
    env: input.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return '';
  }
  return typeof result.stdout === 'string' ? result.stdout : '';
}

function outputHasLine(output: string, expected: string): boolean {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .includes(expected);
}

function nonEmptyEnv(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function kindClusterName(env: NodeJS.ProcessEnv): string {
  return nonEmptyEnv(env.LOCAL_KIND_CLUSTER_NAME ?? env.INTERNAL_AGENT_KIND_CLUSTER_NAME, 'agentsmith');
}

function kindRegistryName(env: NodeJS.ProcessEnv): string {
  return nonEmptyEnv(env.LOCAL_KIND_REGISTRY_NAME, 'kind-registry');
}

function defaultProbe(input: {
  resource: ReleaseCleanupResource;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): boolean {
  if (input.resource === 'kind_cluster') {
    return outputHasLine(
      commandOutput({
        executable: 'kind',
        args: ['get', 'clusters'],
        cwd: input.cwd,
        env: input.env,
      }),
      kindClusterName(input.env),
    );
  }

  if (input.resource === 'kind_registry') {
    return outputHasLine(
      commandOutput({
        executable: 'docker',
        args: ['ps', '-a', '--filter', `name=^/${kindRegistryName(input.env)}$`, '--format', '{{.Names}}'],
        cwd: input.cwd,
        env: input.env,
      }),
      kindRegistryName(input.env),
    );
  }

  const composeProject = input.resource === 'integration_deps'
    ? 'mbos-integration-deps'
    : 'agentsmith-unified-substrate';
  return commandOutput({
    executable: 'docker',
    args: ['ps', '-a', '--filter', `label=com.docker.compose.project=${composeProject}`, '--format', '{{.Names}}'],
    cwd: input.cwd,
    env: input.env,
  }).trim().length > 0;
}

function cleanupCommandFor(input: {
  resource: ReleaseCleanupResource;
  cwd: string;
  env: NodeJS.ProcessEnv;
  campaignRoot: string;
}): ReleaseCleanupCommand {
  if (input.resource === 'unified_substrate') {
    return {
      executable: 'npx',
      args: [
        'tsx',
        'scripts/unified-deploy/substrate-lifecycle.ts',
        'down',
        '--profile=local-kind',
        `--evidence-dir=${join(input.campaignRoot, 'cleanup', 'unified-substrate')}`,
      ],
      cwd: input.cwd,
      env: input.env,
    };
  }

  if (input.resource === 'integration_deps') {
    return {
      executable: 'npm',
      args: ['run', 'integration:deps:down'],
      cwd: input.cwd,
      env: input.env,
    };
  }

  if (input.resource === 'kind_cluster') {
    return {
      executable: 'kind',
      args: ['delete', 'cluster', '--name', kindClusterName(input.env)],
      cwd: input.cwd,
      env: input.env,
    };
  }

  return {
    executable: 'docker',
    args: ['rm', '-f', kindRegistryName(input.env)],
    cwd: input.cwd,
    env: input.env,
  };
}

export function releaseReadyCleanupDisabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.AGENTSMITH_RELEASE_READY_CLEANUP?.trim().toLowerCase();
  return Boolean(value && DISABLED_CLEANUP_VALUES.has(value));
}

export function createReleaseCleanupFinalizer(
  input: CreateReleaseCleanupFinalizerInput,
): ReleaseCleanupFinalizer {
  const probe = input.probeResource
    ?? ((resource: ReleaseCleanupResource, _phase: ReleaseCleanupProbePhase) => defaultProbe({
      resource,
      cwd: input.cwd,
      env: input.env,
    }));
  const cleanupRunner = input.cleanupRunner ?? defaultCleanupRunner;
  const existedBefore = new Map(
    CLEANUP_RESOURCES.map((resource) => [resource, probe(resource, 'before')]),
  );
  let finalized = false;

  return {
    finalize: (_reason: ReleaseCleanupReason) => {
      if (finalized) {
        return;
      }
      finalized = true;

      for (const resource of CLEANUP_RESOURCES) {
        if (existedBefore.get(resource)) {
          continue;
        }
        if (!probe(resource, 'after')) {
          continue;
        }
        cleanupRunner(cleanupCommandFor({
          resource,
          cwd: input.cwd,
          env: input.env,
          campaignRoot: input.campaignRoot,
        }));
      }
    },
  };
}
