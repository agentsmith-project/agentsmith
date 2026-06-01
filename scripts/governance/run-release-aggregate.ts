import { spawnSync } from 'node:child_process';

import {
  AGENTSMITH_RELEASE_CONTRACT_PATH_ENV,
  isDefaultReleaseRunsCampaignRoot,
  writeReleaseSummaryForCampaign,
} from './release-summary';

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${argv[index]}.`);
  }
  return value;
}

function firstNonEmptyString(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function parseArgs(argv: readonly string[]): {
  campaignRoot?: string;
  releaseContractPath?: string;
  passthrough: string[];
} {
  const passthrough: string[] = [];
  let campaignRoot: string | undefined;
  let releaseContractPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--campaign-root' && next) {
      campaignRoot = next;
      index += 1;
    } else if (arg.startsWith('--campaign-root=')) {
      campaignRoot = arg.slice('--campaign-root='.length);
    } else if (arg === '--release-contract') {
      releaseContractPath = requireArgValue(argv, index);
      index += 1;
    } else if (arg.startsWith('--release-contract=')) {
      const value = arg.slice('--release-contract='.length).trim();
      if (!value) {
        throw new Error('missing value for --release-contract.');
      }
      releaseContractPath = value;
    } else {
      passthrough.push(arg);
    }
  }

  return {
    ...(campaignRoot ? { campaignRoot } : {}),
    ...(releaseContractPath ? { releaseContractPath } : {}),
    passthrough,
  };
}

export function runReleaseAggregate(argv: readonly string[] = process.argv.slice(2)): number {
  const parsed = parseArgs(argv);
  const releaseContractPath = firstNonEmptyString(
    parsed.releaseContractPath,
    process.env[AGENTSMITH_RELEASE_CONTRACT_PATH_ENV],
  );
  const env = {
    ...process.env,
    ...(parsed.campaignRoot ? { RELEASE_CAMPAIGN_ROOT: parsed.campaignRoot } : {}),
    ...(releaseContractPath ? { [AGENTSMITH_RELEASE_CONTRACT_PATH_ENV]: releaseContractPath } : {}),
  };

  const aggregate = spawnSync('npm', ['run', 'gate:release:full', ...parsed.passthrough], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });

  const campaignRoot = parsed.campaignRoot ?? process.env.RELEASE_CAMPAIGN_ROOT;
  if (campaignRoot?.trim()) {
    try {
      writeReleaseSummaryForCampaign({
        campaignRoot,
        writeLatest: isDefaultReleaseRunsCampaignRoot(campaignRoot),
        ...(releaseContractPath ? { releaseContractPath } : {}),
      });
    } catch (error) {
      process.stderr.write(`[release:aggregate] failed to write release summary: ${error instanceof Error ? error.message : String(error)}\n`);
      if (aggregate.status === 0) {
        return 1;
      }
    }
  }

  return typeof aggregate.status === 'number' ? aggregate.status : 1;
}

if (isCliEntrypoint('run-release-aggregate.ts')) {
  process.exit(runReleaseAggregate());
}
