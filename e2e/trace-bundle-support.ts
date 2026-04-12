import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type UxTraceRequestSummary = {
  method: string;
  url: string;
  summary?: string;
};

export type UxTraceResponseSummary = {
  status: number;
  summary?: string;
};

export type UxTraceEventInput = {
  stepId: string;
  action: string;
  target?: string;
  input?: string;
  route?: string;
  request?: UxTraceRequestSummary;
  response?: UxTraceResponseSummary;
  assertion?: string;
  note?: string;
};

export type UxTraceCaptureEventInput = {
  stepId: string;
  action: string;
  target: string;
  input?: string;
  route?: string;
  request?: UxTraceRequestSummary;
  response?: UxTraceResponseSummary;
  assertion?: string;
  note?: string;
  fullPage?: boolean;
};

export type UxTraceEventRecord = UxTraceEventInput & {
  seq: number;
  ts: string;
  screenshot?: string;
};

type TraceEventJson = {
  seq: number;
  ts: string;
  step_id: string;
  action: string;
  target?: string;
  input?: string;
  route?: string;
  request?: UxTraceRequestSummary;
  response?: UxTraceResponseSummary;
  assertion?: string;
  note?: string;
  screenshot?: string;
};

export type UxTraceScreenshotRecord = {
  seq: number;
  step_id: string;
  file: string;
  route: string;
  note?: string;
};

export type UxTraceBundleManifest = {
  version: 1;
  story_id: string;
  title: string;
  actor: string;
  lane: string;
  suite: string;
  route: string;
  spec_file: string;
  browser: string;
  run_id: string;
  git_sha: string;
  goal?: string;
  preconditions?: string[];
  seed_data?: string[];
  started_at: string;
  finished_at: string;
  outcome: 'pass' | 'fail';
  event_count: number;
  screenshot_count: number;
  screenshots: UxTraceScreenshotRecord[];
};

export type UxTracePageLike = {
  url(): string;
  screenshot(options: { path: string; fullPage: boolean }): Promise<void>;
};

export type UxTraceBundleOptions = {
  storyId: string;
  title: string;
  actor: string;
  lane: string;
  suite: string;
  route: string;
  specFile: string;
  browser: string;
  gitSha?: string;
  goal?: string;
  preconditions?: string[];
  seedData?: string[];
  runId?: string;
  startedAt?: string;
  outputRoot?: string;
};

export type UxTraceBundleFinishOptions = {
  outcome: 'pass' | 'fail';
  finishedAt?: string;
};

export type UxTraceBundleWriter = {
  bundleDir: string;
  manifestPath: string;
  eventsPath: string;
  reviewPath: string;
  capture(page: UxTracePageLike, event: UxTraceEventInput & { fullPage?: boolean }): Promise<UxTraceEventRecord>;
  note(event: UxTraceEventInput): UxTraceEventRecord;
  finish(options: UxTraceBundleFinishOptions): Promise<UxTraceBundleManifest>;
  events(): UxTraceEventRecord[];
};

export function buildUxTraceCaptureEvent(event: UxTraceCaptureEventInput): UxTraceEventInput {
  return {
    stepId: event.stepId,
    action: event.action,
    target: event.target,
    input: event.input,
    route: event.route,
    request: event.request,
    response: event.response,
    assertion: event.assertion,
    note: event.note,
  };
}

const DEFAULT_TRACE_OUTPUT_ROOT = path.resolve('artifacts/ux-traces');

function sanitizeTraceSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'trace';
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultRunId(): string {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

export function resolveUxTraceBundleDir(options: {
  outputRoot?: string;
  lane: string;
  suite: string;
  storyId: string;
  runId: string;
}): string {
  const root = path.resolve(options.outputRoot ?? process.env.UX_TRACE_OUTPUT_ROOT ?? DEFAULT_TRACE_OUTPUT_ROOT);
  return path.join(
    root,
    sanitizeTraceSegment(options.lane),
    sanitizeTraceSegment(options.suite),
    sanitizeTraceSegment(options.storyId),
    sanitizeTraceSegment(options.runId),
  );
}

export function renderUxTraceEventsJsonl(events: UxTraceEventRecord[]): string {
  return `${events
    .map((event) => JSON.stringify({
      seq: event.seq,
      ts: event.ts,
      step_id: event.stepId,
      action: event.action,
      target: event.target,
      input: event.input,
      route: event.route,
      request: event.request,
      response: event.response,
      assertion: event.assertion,
      note: event.note,
      screenshot: event.screenshot,
    } satisfies TraceEventJson))
    .join('\n')}\n`;
}

export function renderUxTraceReviewMarkdown(args: {
  manifest: UxTraceBundleManifest;
  events: UxTraceEventRecord[];
}): string {
  const { manifest, events } = args;
  const lines = [
    `# ${manifest.title}`,
    '',
    `- story_id: ${manifest.story_id}`,
    `- actor: ${manifest.actor}`,
    `- lane: ${manifest.lane}`,
    `- suite: ${manifest.suite}`,
    `- route: ${manifest.route}`,
    `- spec_file: ${manifest.spec_file}`,
    `- browser: ${manifest.browser}`,
    `- run_id: ${manifest.run_id}`,
    `- outcome: ${manifest.outcome}`,
    `- started_at: ${manifest.started_at}`,
    `- finished_at: ${manifest.finished_at}`,
    '',
    '## Intent',
    '',
    `- goal: ${manifest.goal ?? '<unset>'}`,
    `- preconditions: ${manifest.preconditions?.length ? manifest.preconditions.join('; ') : '<none>'}`,
    `- seed_data: ${manifest.seed_data?.length ? manifest.seed_data.join('; ') : '<none>'}`,
    '',
    '## Evidence',
    '',
    '- manifest.json',
    '- events.jsonl',
    '- screenshots/',
    '',
    '## Trace Events',
    '',
    '| Seq | Step | Action | Target | Route | Screenshot | Assertion | Note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...events.map((event) => `| ${event.seq} | ${event.stepId} | ${event.action} | ${event.target ?? ''} | ${event.route ?? manifest.route} | ${event.screenshot ?? ''} | ${event.assertion ?? ''} | ${event.note ?? ''} |`),
    '',
    '## Screenshots',
    '',
    ...manifest.screenshots.map((shot) => `- ${shot.file} (${shot.step_id})`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export async function createUxTraceBundleWriter(options: UxTraceBundleOptions): Promise<UxTraceBundleWriter> {
  const runId = options.runId ?? process.env.UX_TRACE_RUN_ID ?? defaultRunId();
  const bundleDir = resolveUxTraceBundleDir({
    outputRoot: options.outputRoot,
    lane: options.lane,
    suite: options.suite,
    storyId: options.storyId,
    runId,
  });
  const screenshotsDir = path.join(bundleDir, 'screenshots');
  await mkdir(screenshotsDir, { recursive: true });

  const startedAt = options.startedAt ?? nowIso();
  const events: UxTraceEventRecord[] = [];

  const writeBundle = async (manifest: UxTraceBundleManifest) => {
    await mkdir(bundleDir, { recursive: true });
    await writeFile(path.join(bundleDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    await writeFile(path.join(bundleDir, 'events.jsonl'), renderUxTraceEventsJsonl(events), 'utf-8');
    await writeFile(path.join(bundleDir, 'review.md'), renderUxTraceReviewMarkdown({ manifest, events }), 'utf-8');
  };

  return {
    bundleDir,
    manifestPath: path.join(bundleDir, 'manifest.json'),
    eventsPath: path.join(bundleDir, 'events.jsonl'),
    reviewPath: path.join(bundleDir, 'review.md'),
    events: () => [...events],
    capture: async (page, event) => {
      const seq = events.length + 1;
      const screenshotFile = `screenshots/${String(seq).padStart(3, '0')}-${sanitizeTraceSegment(event.stepId)}.png`;
      await page.screenshot({
        path: path.join(bundleDir, screenshotFile),
        fullPage: event.fullPage ?? true,
      });
      const record: UxTraceEventRecord = {
        seq,
        ts: nowIso(),
        stepId: event.stepId,
        action: event.action,
        target: event.target,
        input: event.input,
        route: event.route ?? page.url(),
        request: event.request,
        response: event.response,
        assertion: event.assertion,
        note: event.note,
        screenshot: screenshotFile,
      };
      events.push(record);
      return record;
    },
    note: (event) => {
      const record: UxTraceEventRecord = {
        seq: events.length + 1,
        ts: nowIso(),
        stepId: event.stepId,
        action: event.action,
        target: event.target,
        input: event.input,
        route: event.route,
        request: event.request,
        response: event.response,
        assertion: event.assertion,
        note: event.note,
      };
      events.push(record);
      return record;
    },
    finish: async (finishOptions) => {
      const manifest: UxTraceBundleManifest = {
        version: 1,
        story_id: options.storyId,
        title: options.title,
        actor: options.actor,
        lane: options.lane,
        suite: options.suite,
        route: options.route,
        spec_file: options.specFile,
        browser: options.browser,
        run_id: runId,
        git_sha: options.gitSha?.trim() || process.env.GIT_SHA?.trim() || process.env.CI_COMMIT_SHA?.trim() || 'local',
        goal: options.goal,
        preconditions: options.preconditions,
        seed_data: options.seedData,
        started_at: startedAt,
        finished_at: finishOptions.finishedAt ?? nowIso(),
        outcome: finishOptions.outcome,
        event_count: events.length,
        screenshot_count: events.filter((event) => Boolean(event.screenshot)).length,
        screenshots: events
          .filter((event): event is UxTraceEventRecord & { screenshot: string } => Boolean(event.screenshot))
          .map((event) => ({
            seq: event.seq,
            step_id: event.stepId,
            file: event.screenshot,
            route: event.route ?? options.route,
            note: event.note,
          })),
      };

      await writeBundle(manifest);
      return manifest;
    },
  };
}
