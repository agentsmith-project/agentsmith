import {
  readReleaseStatus,
  renderReleaseStatus,
} from './release-summary';

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function parseArgs(argv: readonly string[]): { latestPath?: string; campaignRoot?: string } {
  const options: { latestPath?: string; campaignRoot?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--latest-path' && next) {
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
      throw new Error(`Unknown release status argument: ${arg}`);
    }
  }
  return options;
}

export function runReleaseStatus(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const status = readReleaseStatus(parseArgs(argv));
    process.stdout.write(renderReleaseStatus(status));
    return status.kind === 'ready' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`[release-status] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isCliEntrypoint('release-status.ts')) {
  process.exit(runReleaseStatus());
}
