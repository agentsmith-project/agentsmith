import { spawnSync } from 'node:child_process';

import {
  isDefaultReleaseRunsCampaignRoot,
  writeReleaseSummaryForCampaign,
} from './release-summary';

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function parseArgs(argv: readonly string[]): { campaignRoot?: string; passthrough: string[] } {
  const passthrough: string[] = [];
  let campaignRoot: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--campaign-root' && next) {
      campaignRoot = next;
      index += 1;
    } else if (arg.startsWith('--campaign-root=')) {
      campaignRoot = arg.slice('--campaign-root='.length);
    } else {
      passthrough.push(arg);
    }
  }

  return { campaignRoot, passthrough };
}

export function runReleaseAggregate(argv: readonly string[] = process.argv.slice(2)): number {
  const parsed = parseArgs(argv);
  const env = {
    ...process.env,
    ...(parsed.campaignRoot ? { RELEASE_CAMPAIGN_ROOT: parsed.campaignRoot } : {}),
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
