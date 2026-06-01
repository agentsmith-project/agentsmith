import {
  readReleaseStatus,
  renderReleaseStatus,
  resolveCurrentGitSha,
  type ReleaseStatusRead,
} from './release-summary';
import { resolveMinimalLeaseStatusShadow } from './lease-status-shadow';
import {
  buildStatusProjection,
  renderHumanReleaseText,
  renderStatusProjectionSummary,
} from './status-projection';
import type {
  CurrentStatusProjection,
  CurrentStatusProjectionPhase,
  CurrentStatusProjectionPresentationStatus,
} from './current-status-projection-schema';
import { PRODUCT_READY_COMMAND } from './product-readiness-entrypoints';

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

type ReleaseStatusReadFailure = Exclude<ReleaseStatusRead, { kind: 'ready' }>;

interface ReleaseStatusFailureProjectionInput {
  status: ReleaseStatusReadFailure;
  currentGitSha: string | null;
  leaseStatusShadow: CurrentStatusProjection['lease_status_shadow'];
}

interface ReleaseStatusFailureProjectionDetails {
  blocker: string;
  phase: CurrentStatusProjectionPhase;
  presentationStatus: CurrentStatusProjectionPresentationStatus;
  sourcePath: string;
  summary: string;
}

function releaseStatusFailureProjectionDetails(
  status: ReleaseStatusReadFailure,
): ReleaseStatusFailureProjectionDetails {
  if (status.kind === 'missing_latest') {
    return {
      blocker: 'release_status_missing_latest',
      phase: 'not-started',
      presentationStatus: 'unknown',
      sourcePath: status.latestPath,
      summary: `Latest release summary pointer was not found: ${status.latestPath}`,
    };
  }

  if (status.kind === 'missing_summary') {
    return {
      blocker: 'release_status_missing_summary',
      phase: 'report',
      presentationStatus: 'unknown',
      sourcePath: status.summaryPath,
      summary: `Product readiness summary is missing: ${status.summaryPath}`,
    };
  }

  return {
    blocker: 'release_status_malformed',
    phase: 'report',
    presentationStatus: 'unknown',
    sourcePath: status.latestPath,
    summary: renderHumanReleaseText(status.error),
  };
}

function buildReleaseStatusFailureProjection(
  input: ReleaseStatusFailureProjectionInput,
): CurrentStatusProjection {
  const details = releaseStatusFailureProjectionDetails(input.status);
  const projection = buildStatusProjection({
    goal: 'product-readiness',
    currentGitSha: input.currentGitSha,
    leaseStatusShadow: input.leaseStatusShadow,
    phase: details.phase,
  });

  return {
    ...projection,
    phase: details.phase,
    presentation_status: details.presentationStatus,
    primary_blocker: {
      owner: details.blocker,
      stage: details.phase,
      path: details.sourcePath,
    },
    deepest_reason: {
      code: details.blocker,
      summary: details.summary,
      source_path: details.sourcePath,
    },
    safe_next_command: PRODUCT_READY_COMMAND,
    resume_recommendation: {
      ...projection.resume_recommendation,
      safe_next_command: PRODUCT_READY_COMMAND,
      reason_codes: [details.blocker],
    },
    authority_paths: {
      ...projection.authority_paths,
      stage: details.sourcePath,
    },
  };
}

export function runReleaseStatus(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const options = parseArgs(argv);
    const status = options.campaignRoot ? null : readReleaseStatus(options);
    const campaignRoot = options.campaignRoot
      ?? (status?.kind === 'ready' ? status.summary.campaign_root : null);
    const runId = status?.kind === 'ready' ? status.summary.campaign_run_id : null;
    const evidenceGitSha = status?.kind === 'ready' ? status.latest?.git_sha ?? null : null;
    const currentGitSha = tryResolveCurrentGitSha();
    const leaseStatusShadow = resolveMinimalLeaseStatusShadow();
    const statusReadFailure = !options.campaignRoot && status && status.kind !== 'ready' ? status : null;
    const projection = statusReadFailure
      ? buildReleaseStatusFailureProjection({
          status: statusReadFailure,
          currentGitSha,
          leaseStatusShadow,
        })
      : buildStatusProjection({
          goal: 'product-readiness',
          campaignRoot,
          runId,
          currentGitSha,
          evidenceGitSha,
          leaseStatusShadow,
        });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
      return statusReadFailure ? 1 : 0;
    }

    if (!options.campaignRoot && status && status.kind !== 'ready') {
      process.stdout.write(renderReleaseStatus(status));
      return 1;
    }

    process.stdout.write(renderStatusProjectionSummary(projection));
    return projection.aggregate_status_ref ? 0 : 1;
  } catch {
    process.stderr.write('[release-status] status unavailable; check arguments and release artifacts.\n');
    return 1;
  }
}

if (isCliEntrypoint('release-status.ts')) {
  process.exit(runReleaseStatus());
}
