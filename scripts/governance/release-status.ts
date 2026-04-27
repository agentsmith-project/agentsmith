import {
  readReleaseStatus,
  resolveCurrentGitSha,
} from './release-summary';
import { buildStatusProjection, renderStatusProjection } from './status-projection';

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function parseArgs(argv: readonly string[]): { latestPath?: string; campaignRoot?: string; json?: boolean } {
  const options: { latestPath?: string; campaignRoot?: string; json?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--latest-path' && next) {
      options.latestPath = next;
      index += 1;
    } else if (arg.startsWith('--latest-path=')) {
      options.latestPath = arg.slice('--latest-path='.length);
    } else if (arg === '--campaign-root' && next) {
      options.campaignRoot = next;
      index += 1;
    } else if (arg.startsWith('--campaign-root=')) {
      options.campaignRoot = arg.slice('--campaign-root='.length);
    } else {
      throw new Error('Unknown release status argument.');
    }
  }
  return options;
}

function tryResolveCurrentGitSha(): string | null {
  try {
    return resolveCurrentGitSha();
  } catch {
    return null;
  }
}

export function runReleaseStatus(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const options = parseArgs(argv);
    const status = options.campaignRoot ? null : readReleaseStatus(options);
    const campaignRoot = options.campaignRoot
      ?? (status?.kind === 'ready' ? status.summary.campaign_root : null);
    const runId = status?.kind === 'ready' ? status.summary.campaign_run_id : null;
    const evidenceGitSha = status?.kind === 'ready' ? status.latest?.git_sha ?? null : null;
    const projection = buildStatusProjection({
      goal: 'release-ready',
      campaignRoot,
      runId,
      currentGitSha: tryResolveCurrentGitSha(),
      evidenceGitSha,
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
      return 0;
    }

    process.stdout.write(renderStatusProjection(projection));
    return projection.aggregate_status_ref ? 0 : 1;
  } catch {
    process.stderr.write('[release-status] status unavailable; check arguments and release artifacts.\n');
    return 1;
  }
}

if (isCliEntrypoint('release-status.ts')) {
  process.exit(runReleaseStatus());
}
