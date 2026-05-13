import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStorySourceFingerprint, type StoryDefinition, type StoryStepDefinition } from '../e2e/story-contract';
import { loadStoryDefinition } from '../e2e/story-loader';
import { buildTraceStoryBinding, type TraceStoryBinding } from '../e2e/story-trace-binding';
import {
  createUxTraceBundleWriter,
  buildUxTraceCaptureEvent,
  validateUxTraceBundleArtifact,
  resolveUxTraceBundleDir,
  type UxTracePageLike,
} from '../e2e/trace-bundle-support';

function makeFakePage(url: string): UxTracePageLike {
  return {
    url: () => url,
    screenshot: async ({ path: screenshotPath }) => {
      await writeFile(screenshotPath, 'fake screenshot', 'utf-8');
    },
  };
}

type ScreenshotAttempt = {
  path: string;
  fullPage: boolean;
};

function makeScriptedScreenshotPage(args: {
  url: string;
  attempts: ScreenshotAttempt[];
  handlers: Array<(attempt: ScreenshotAttempt) => Promise<void>>;
}): UxTracePageLike {
  return {
    url: () => args.url,
    screenshot: async (attempt) => {
      args.attempts.push(attempt);
      const handler = args.handlers[args.attempts.length - 1];
      if (!handler) {
        throw new Error(`unexpected screenshot attempt ${args.attempts.length}`);
      }
      await handler(attempt);
    },
  };
}

function stepRoute(story: StoryDefinition, step: StoryStepDefinition): string {
  const scene = story.scenes.find((candidate) => candidate.sceneId === step.sceneId);
  return scene?.route ?? story.entryRoute;
}

function makeSingleStepTraceBinding(): TraceStoryBinding {
  return {
    storyId: 'workspace-provisioning',
    title: 'Workspace provisioning',
    actor: 'system 管理侧',
    family: 'system_admin_detail',
    personas: ['system_admin'],
    kind: 'journey',
    gatePolicy: {
      tier: 'release',
      requiredEvidence: ['trace'],
    },
    externalDependencies: [],
    goal: 'Capture a single required trace step.',
    preconditions: [],
    seedData: [],
    storySource: 'scripts/trace-bundle-support.test.ts#workspace-provisioning',
    storyFingerprint: 'single-step-story-fingerprint',
    stepMapFingerprint: 'single-step-map-fingerprint',
    steps: [
      {
        stepId: 'system-login',
        sceneId: 'system-login',
        intent: 'Open system login',
        action: 'Open system login',
        target: 'system-login__heading',
        expectedFeedback: 'system login heading is visible',
        evidence: ['trace'],
      },
    ],
  };
}

describe('ux trace bundle support', () => {
  it('resolves a canonical run-scoped bundle directory', () => {
    const resolved = resolveUxTraceBundleDir({
      outputRoot: '/tmp/agentsmith-ux-traces',
      lane: 'backend-real',
      suite: 'integration-release-user-story',
      storyId: 'workspace-provisioning',
      runId: 'run-20260412-001',
    });

    expect(resolved).toBe(
      path.join(
        '/tmp/agentsmith-ux-traces',
        'backend-real',
        'integration-release-user-story',
        'workspace-provisioning',
        'run-20260412-001',
      ),
    );
  });

  it('writes a first-class trace bundle with manifest, events, review, and screenshots', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-traces-'));
    try {
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: 'workspace-provisioning',
        title: 'Workspace provisioning',
        actor: 'system 管理侧',
        route: '/en-US/system/login',
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        gitSha: 'abc123',
        goal: '把系统管理侧、工作区和项目的关键入口串联起来。',
        preconditions: ['backend-real stack is ready', 'seeded admin session'],
        seedData: ['ws_default', 'proj_001'],
        runId: 'run-001',
        startedAt: '2026-04-12T01:23:45.000Z',
      });

      await trace.capture(makeFakePage('/en-US/system/login'), {
        stepId: 'system-login',
        action: 'Open system login',
        target: 'system-login__heading',
        assertion: 'system login heading is visible',
        note: 'entry page',
      });

      await trace.capture(makeFakePage('/en-US/workspaces/ws_default/login'), {
        stepId: 'workspace-login',
        action: 'Open workspace login',
        target: 'workspace-login__keycloak-btn',
        input: 'Click Keycloak login',
        request: {
          method: 'POST',
          url: '/api/system/session',
          summary: 'auth session established',
        },
        response: {
          status: 200,
          summary: 'session cookie issued',
        },
        assertion: 'workspace login button is visible',
      });

      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T01:25:45.000Z',
      });

      const bundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: 'workspace-provisioning',
        runId: 'run-001',
      });

      const manifestPath = path.join(bundleDir, 'manifest.json');
      const contractSnapshotPath = path.join(bundleDir, 'contract-snapshot.json');
      const eventsPath = path.join(bundleDir, 'events.jsonl');
      const reviewPath = path.join(bundleDir, 'review.md');
      const indexPath = path.join(rootDir, 'ux-trace-index.json');
      const firstScreenshot = path.join(bundleDir, 'screenshots', '001-system-login.png');
      const secondScreenshot = path.join(bundleDir, 'screenshots', '002-workspace-login.png');

      await expect(readFile(manifestPath, 'utf-8')).resolves.toContain('"story_id": "workspace-provisioning"');
      await expect(readFile(manifestPath, 'utf-8')).resolves.toContain('"screenshot_count": 2');
      await expect(readFile(contractSnapshotPath, 'utf-8')).resolves.toContain('"story_id": "workspace-provisioning"');
      await expect(readFile(indexPath, 'utf-8')).resolves.toContain('"bundle_relpath": "backend-real/integration-release-user-story/workspace-provisioning/run-001"');
      const eventLines = (await readFile(eventsPath, 'utf-8')).trim().split('\n');
      expect(eventLines).toHaveLength(2);
      expect(JSON.parse(eventLines[0] ?? '{}')).toMatchObject({
        seq: 1,
        step_id: 'system-login',
        screenshot: 'screenshots/001-system-login.png',
      });
      expect(JSON.parse(eventLines[1] ?? '{}')).toMatchObject({
        seq: 2,
        step_id: 'workspace-login',
        request: {
          method: 'POST',
          url: '/api/system/session',
          summary: 'auth session established',
        },
        response: {
          status: 200,
          summary: 'session cookie issued',
        },
      });
      const reviewContent = await readFile(reviewPath, 'utf-8');
      expect(reviewContent).toContain('# Workspace provisioning');
      expect(reviewContent).toContain('events.jsonl');
      expect(reviewContent).toContain('screenshots/001-system-login.png');
      await expect(readFile(firstScreenshot, 'utf-8')).resolves.toBe('fake screenshot');
      await expect(readFile(secondScreenshot, 'utf-8')).resolves.toBe('fake screenshot');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('captures the first screenshot attempt with the default fullPage semantics', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-traces-fullpage-'));
    try {
      const attempts: ScreenshotAttempt[] = [];
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: 'workspace-provisioning',
        title: 'Workspace provisioning',
        actor: 'system 管理侧',
        route: '/en-US/system/login',
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        gitSha: 'abc123',
        runId: 'run-fullpage-success',
        startedAt: '2026-04-12T01:23:45.000Z',
      });

      await trace.capture(makeScriptedScreenshotPage({
        url: '/en-US/system/login',
        attempts,
        handlers: [
          async ({ path: screenshotPath }) => {
            await writeFile(screenshotPath, 'full page screenshot', 'utf-8');
          },
        ],
      }), {
        stepId: 'system-login',
        action: 'Open system login',
      });
      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T01:25:45.000Z',
      });

      expect(attempts.map((attempt) => attempt.fullPage)).toEqual([true]);
      const manifest = JSON.parse(await readFile(trace.manifestPath, 'utf-8')) as {
        capture_warning_count?: number;
        capture_warnings?: unknown[];
      };
      expect(manifest.capture_warning_count).toBe(0);
      expect(manifest.capture_warnings).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('falls back to a viewport screenshot and records warning evidence when fullPage capture fails transiently', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-traces-fallback-'));
    try {
      const attempts: ScreenshotAttempt[] = [];
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: 'workspace-provisioning',
        title: 'Workspace provisioning',
        actor: 'system 管理侧',
        route: '/en-US/system/login',
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        gitSha: 'abc123',
        runId: 'run-viewport-fallback',
        startedAt: '2026-04-12T01:23:45.000Z',
        storyBinding: makeSingleStepTraceBinding(),
      });

      const record = await trace.capture(makeScriptedScreenshotPage({
        url: '/en-US/system/login',
        attempts,
        handlers: [
          async () => {
            throw new Error('page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot');
          },
          async ({ path: screenshotPath }) => {
            await writeFile(screenshotPath, 'viewport fallback screenshot', 'utf-8');
          },
        ],
      }), {
        stepId: 'system-login',
        action: 'Open system login',
      });
      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T01:25:45.000Z',
      });

      const warningFile = 'capture-warnings/001-system-login-screenshot.json';
      expect(attempts.map((attempt) => attempt.fullPage)).toEqual([true, false]);
      expect(record.screenshot).toBe('screenshots/001-system-login.png');
      await expect(readFile(path.join(trace.bundleDir, 'screenshots', '001-system-login.png'), 'utf-8'))
        .resolves.toBe('viewport fallback screenshot');

      const eventJson = JSON.parse((await readFile(trace.eventsPath, 'utf-8')).trim()) as {
        screenshot_capture?: {
          mode?: string;
          requested_full_page?: boolean;
          fallback?: boolean;
          warning_file?: string;
        };
      };
      expect(eventJson.screenshot_capture).toMatchObject({
        mode: 'viewport_fallback',
        requested_full_page: true,
        fallback: true,
        warning_file: warningFile,
      });

      const manifest = JSON.parse(await readFile(trace.manifestPath, 'utf-8')) as {
        capture_warning_count?: number;
        capture_warnings?: Array<{ file?: string; kind?: string; step_id?: string }>;
        screenshots?: Array<{ capture_mode?: string; warning_file?: string }>;
      };
      expect(manifest.capture_warning_count).toBe(1);
      expect(manifest.capture_warnings).toEqual([
        expect.objectContaining({
          file: warningFile,
          kind: 'screenshot_full_page_failed',
          step_id: 'system-login',
        }),
      ]);
      expect(manifest.screenshots?.[0]).toMatchObject({
        capture_mode: 'viewport_fallback',
        warning_file: warningFile,
      });

      const warning = JSON.parse(await readFile(path.join(trace.bundleDir, warningFile), 'utf-8')) as {
        schema?: string;
        kind?: string;
        step_id?: string;
        fallback_full_page?: boolean;
        message?: string;
      };
      expect(warning).toMatchObject({
        schema: 'ux_trace_capture_warning/v1',
        kind: 'screenshot_full_page_failed',
        step_id: 'system-login',
        fallback_full_page: false,
      });
      expect(warning.message).toMatch(/Page\.captureScreenshot|Unable to capture screenshot/);

      const review = await readFile(trace.reviewPath, 'utf-8');
      expect(review).toContain(warningFile);
      expect(review).toContain('viewport_fallback');

      const validation = validateUxTraceBundleArtifact({
        bundleDir: trace.bundleDir,
        expectedLane: 'backend-real',
        expectedSuite: 'integration-release-user-story',
      });
      expect(validation.ok).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('throws when both fullPage capture and viewport fallback fail', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-traces-fallback-failed-'));
    try {
      const attempts: ScreenshotAttempt[] = [];
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: 'workspace-provisioning',
        title: 'Workspace provisioning',
        actor: 'system 管理侧',
        route: '/en-US/system/login',
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        gitSha: 'abc123',
        runId: 'run-viewport-fallback-failed',
        startedAt: '2026-04-12T01:23:45.000Z',
      });

      await expect(trace.capture(makeScriptedScreenshotPage({
        url: '/en-US/system/login',
        attempts,
        handlers: [
          async () => {
            throw new Error('page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot');
          },
          async () => {
            throw new Error('page.screenshot: viewport capture failed');
          },
        ],
      }), {
        stepId: 'system-login',
        action: 'Open system login',
      })).rejects.toThrow(/viewport fallback screenshot failed|viewport capture failed/i);

      expect(attempts.map((attempt) => attempt.fullPage)).toEqual([true, false]);
      expect(trace.events()).toEqual([]);
      await expect(readFile(
        path.join(trace.bundleDir, 'capture-warnings', '001-system-login-screenshot.json'),
        'utf-8',
      )).resolves.toContain('screenshot_full_page_failed');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('validates producer-owned bundles from contract-snapshot.json without reloading the current repo story id', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-traces-snapshot-owned-'));
    try {
      const story = await loadStoryDefinition('release-user-story-end-to-end');
      const binding = buildTraceStoryBinding(story);
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: story.storyId,
        title: story.title,
        actor: story.actor,
        route: story.entryRoute,
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        runId: 'run-snapshot-owned',
        startedAt: '2026-04-12T08:03:04.000Z',
        goal: story.goal,
        preconditions: story.preconditions ?? [],
        seedData: story.seedData ?? [],
        storyBinding: binding,
      });

      for (const step of binding.steps.filter((candidate) => candidate.evidence.includes('trace') && !candidate.optional)) {
        await trace.capture(makeFakePage(stepRoute(story, step)), { stepId: step.stepId });
      }

      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T08:04:04.000Z',
      });

      const originalBundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: story.storyId,
        runId: 'run-snapshot-owned',
      });
      const movedStoryId = 'release-user-story-end-to-end-moved';
      const movedBundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: movedStoryId,
        runId: 'run-snapshot-owned',
      });

      await rm(movedBundleDir, { recursive: true, force: true }).catch(() => {});
      await mkdir(path.dirname(movedBundleDir), { recursive: true });
      await rename(originalBundleDir, movedBundleDir);

      const manifestPath = path.join(movedBundleDir, 'manifest.json');
      const reviewPath = path.join(movedBundleDir, 'review.md');
      const contractSnapshotPath = path.join(movedBundleDir, 'contract-snapshot.json');
      const indexPath = path.join(rootDir, 'ux-trace-index.json');

      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
      manifest.story_id = movedStoryId;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

      const snapshot = JSON.parse(await readFile(contractSnapshotPath, 'utf-8')) as Record<string, unknown>;
      snapshot.story_id = movedStoryId;
      await writeFile(contractSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');

      const review = (await readFile(reviewPath, 'utf-8')).replace(
        `- story_id: ${story.storyId}`,
        `- story_id: ${movedStoryId}`,
      );
      await writeFile(reviewPath, review, 'utf-8');

      const index = JSON.parse(await readFile(indexPath, 'utf-8')) as {
        bundles: Array<Record<string, unknown>>;
      };
      index.bundles = index.bundles.map((entry) => ({
        ...entry,
        story_id: movedStoryId,
        bundle_relpath: 'backend-real/integration-release-user-story/release-user-story-end-to-end-moved/run-snapshot-owned',
      }));
      await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf-8');

      const validation = validateUxTraceBundleArtifact({
        bundleDir: movedBundleDir,
        expectedLane: 'backend-real',
        expectedSuite: 'integration-release-user-story',
      });

      expect(validation.ok).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails validation under an evidence root when ux-trace-index.json does not declare the bundle', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-traces-index-required-'));
    try {
      const story = await loadStoryDefinition('release-user-story-end-to-end');
      const binding = buildTraceStoryBinding(story);
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: story.storyId,
        title: story.title,
        actor: story.actor,
        route: story.entryRoute,
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        runId: 'run-missing-index-entry',
        startedAt: '2026-04-12T09:03:04.000Z',
        goal: story.goal,
        preconditions: story.preconditions ?? [],
        seedData: story.seedData ?? [],
        storyBinding: binding,
      });

      for (const step of binding.steps.filter((candidate) => candidate.evidence.includes('trace') && !candidate.optional)) {
        await trace.capture(makeFakePage(stepRoute(story, step)), { stepId: step.stepId });
      }
      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T09:04:04.000Z',
      });

      const bundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: story.storyId,
        runId: 'run-missing-index-entry',
      });
      await writeFile(path.join(rootDir, 'ux-trace-index.json'), `${JSON.stringify({
        version: 1,
        generated_at: '2026-04-12T09:04:05.000Z',
        bundles: [],
      }, null, 2)}\n`, 'utf-8');

      const validation = validateUxTraceBundleArtifact({
        bundleDir,
        expectedLane: 'backend-real',
        expectedSuite: 'integration-release-user-story',
        expectedEvidenceRoot: rootDir,
      });

      expect(validation.ok).toBe(false);
      if (validation.ok) {
        throw new Error('expected validation to fail when ux-trace-index.json omits the bundle');
      }
      expect(validation.failureClass).toBe('evidence_missing');
      expect(validation.message).toMatch(/ux-trace-index\.json/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps integration-release-user-story bundles under the canonical backend-real trace tree', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-traces-'));
    try {
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: 'release-user-story-end-to-end',
        title: 'Release user story end-to-end',
        actor: 'system 管理侧 / workspace admin / project owner / member',
        route: '/en-US/system/login',
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        runId: 'run-002',
        startedAt: '2026-04-12T02:03:04.000Z',
      });

      await trace.capture(makeFakePage('/en-US/system/login'), {
        stepId: 'system-login',
        action: 'Open system login',
        target: 'system-login__heading',
        note: 'release story entry',
      });

      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T02:04:04.000Z',
      });

      const bundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: 'release-user-story-end-to-end',
        runId: 'run-002',
      });

      await expect(readFile(path.join(bundleDir, 'manifest.json'), 'utf-8')).resolves.toContain('"suite": "integration-release-user-story"');
      await expect(readFile(path.join(bundleDir, 'manifest.json'), 'utf-8')).resolves.toContain('"story_id": "release-user-story-end-to-end"');
      await expect(readFile(path.join(bundleDir, 'events.jsonl'), 'utf-8')).resolves.toContain('"step_id":"system-login"');
      await expect(readFile(path.join(bundleDir, 'review.md'), 'utf-8')).resolves.toContain('# Release user story end-to-end');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('records the committed markdown source fingerprint when a story binding is supplied', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-traces-'));
    try {
      const story = await loadStoryDefinition('release-user-story-end-to-end');
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: story.storyId,
        title: story.title,
        actor: story.actor,
        route: story.entryRoute,
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        runId: 'run-003',
        startedAt: '2026-04-12T03:03:04.000Z',
        storyBinding: {
          storyId: story.storyId,
          title: story.title,
          actor: story.actor,
          goal: story.goal,
          preconditions: story.preconditions ?? [],
          seedData: story.seedData ?? [],
          storySource: story.sourceFile ?? story.filePath,
          storyFingerprint: 'story-fingerprint',
          stepMapFingerprint: 'step-map-fingerprint',
          steps: story.steps,
        },
      });

      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T03:04:04.000Z',
      });

      const bundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: story.storyId,
        runId: 'run-003',
      });

      const manifest = JSON.parse(await readFile(path.join(bundleDir, 'manifest.json'), 'utf-8')) as {
        story_source_fingerprint?: string;
      };
      expect(manifest.story_source_fingerprint).toBe(
        buildStorySourceFingerprint(await readFile(path.resolve(story.sourceFile ?? story.filePath), 'utf-8')),
      );
      await expect(readFile(path.join(bundleDir, 'review.md'), 'utf-8')).resolves.toContain('- story_source_fingerprint:');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('records semantic trace requirements and review verdict metadata from the story binding', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-traces-'));
    try {
      const story = await loadStoryDefinition('release-user-story-end-to-end');
      const binding = buildTraceStoryBinding(story);
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: story.storyId,
        title: story.title,
        actor: story.actor,
        route: story.entryRoute,
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        runId: 'run-semantic',
        startedAt: '2026-04-12T04:03:04.000Z',
        goal: story.goal,
        preconditions: story.preconditions ?? [],
        seedData: story.seedData ?? [],
        storyBinding: binding,
      });

      await trace.capture(makeFakePage('/en-US/system/login'), {
        stepId: 'system-login',
      });
      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T04:04:04.000Z',
      });

      const bundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: 'backend-real',
        suite: 'integration-release-user-story',
        storyId: story.storyId,
        runId: 'run-semantic',
      });
      const manifest = JSON.parse(await readFile(path.join(bundleDir, 'manifest.json'), 'utf-8')) as {
        scenario_id?: string;
        required_trace_steps?: string[];
        required_screenshot_steps?: string[];
      };
      const requiredTraceSteps = binding.steps
        .filter((step) => step.evidence.includes('trace') && !step.optional)
        .map((step) => step.stepId);
      const requiredScreenshotSteps = binding.steps
        .filter((step) => step.evidence.includes('trace') && !step.optional && step.sceneId)
        .map((step) => step.stepId);

      expect(manifest.scenario_id).toBe('integration-release-user-story');
      expect(manifest.required_trace_steps).toEqual(requiredTraceSteps);
      expect(manifest.required_screenshot_steps).toEqual(requiredScreenshotSteps);
      const review = await readFile(path.join(bundleDir, 'review.md'), 'utf-8');
      expect(review).toContain('- schema: ux_trace_bundle_review/v1');
      expect(review).toContain('- story_id: release-user-story-end-to-end');
      expect(review).toContain('- scenario_id: integration-release-user-story');
      expect(review).toContain('- outcome: pass');
      expect(review).toContain('- verdict: accepted');
      expect(review).toContain('- findings: No blocking findings.');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('preserves visual review action and target fields when building capture events', () => {
    const event = buildUxTraceCaptureEvent({
      stepId: 'system-login',
      action: 'Open system login',
      target: 'system-login__heading',
      note: 'system 管理侧登录入口',
      route: '/en-US/system/login',
    });

    expect(event).toMatchObject({
      stepId: 'system-login',
      action: 'Open system login',
      target: 'system-login__heading',
      note: 'system 管理侧登录入口',
      route: '/en-US/system/login',
    });
  });

  it('fails validation when required trace steps all appear but are recorded out of canonical order', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-trace-ordering-'));
    try {
      const story = await loadStoryDefinition('release-user-story-end-to-end');
      const binding = buildTraceStoryBinding(story);
      const suite = 'integration-release-user-story';
      const runId = 'run-ordering-drift';
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: story.lane,
        suite,
        storyId: story.storyId,
        title: story.title,
        actor: story.actor,
        route: story.entryRoute,
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        runId,
        startedAt: '2026-04-12T05:03:04.000Z',
        goal: story.goal,
        preconditions: story.preconditions ?? [],
        seedData: story.seedData ?? [],
        storyBinding: binding,
      });

      const requiredTraceSteps = binding.steps.filter((step) => step.evidence.includes('trace') && !step.optional);
      expect(requiredTraceSteps.length).toBeGreaterThan(1);

      for (const step of requiredTraceSteps) {
        await trace.capture(makeFakePage(stepRoute(story, step)), { stepId: step.stepId });
      }

      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T05:04:04.000Z',
      });

      const bundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: story.lane,
        suite,
        storyId: story.storyId,
        runId,
      });
      const eventsPath = path.join(bundleDir, 'events.jsonl');
      const originalEvents = (await readFile(eventsPath, 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as {
          seq: number;
          step_id: string;
        });
      const reorderedEvents = [originalEvents[1], originalEvents[0], ...originalEvents.slice(2)].map((event, index) => ({
        ...event,
        seq: index + 1,
      }));

      await writeFile(eventsPath, `${reorderedEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf-8');

      const validation = validateUxTraceBundleArtifact({
        bundleDir,
        expectedLane: story.lane,
        expectedSuite: suite,
      });

      expect(validation.ok).toBe(false);
      if (validation.ok) {
        throw new Error('expected UX trace bundle validation to fail for sequence drift');
      }
      expect(validation.failureClass).toBe('contract_drift');
      expect(validation.message).toMatch(/order|sequence/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects a producer-owned trace bundle when manifest.json omits trace_order_contract', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-trace-order-contract-missing-'));
    try {
      const story = await loadStoryDefinition('release-user-story-end-to-end');
      const binding = buildTraceStoryBinding(story);
      const suite = 'integration-release-user-story';
      const runId = 'run-missing-trace-order-contract';
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: story.lane,
        suite,
        storyId: story.storyId,
        title: story.title,
        actor: story.actor,
        route: story.entryRoute,
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        runId,
        startedAt: '2026-04-12T06:03:04.000Z',
        goal: story.goal,
        preconditions: story.preconditions ?? [],
        seedData: story.seedData ?? [],
        storyBinding: binding,
      });

      const requiredTraceSteps = binding.steps.filter((step) => step.evidence.includes('trace') && !step.optional);
      expect(requiredTraceSteps.length).toBeGreaterThan(1);

      for (const step of requiredTraceSteps) {
        await trace.capture(makeFakePage(stepRoute(story, step)), { stepId: step.stepId });
      }

      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T06:04:04.000Z',
      });

      const bundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: story.lane,
        suite,
        storyId: story.storyId,
        runId,
      });
      const manifestPath = path.join(bundleDir, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
      const baselineValidation = validateUxTraceBundleArtifact({
        bundleDir,
        expectedLane: story.lane,
        expectedSuite: suite,
      });

      expect(baselineValidation.ok).toBe(true);
      expect(manifest.trace_order_contract).toBeDefined();

      delete manifest.trace_order_contract;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

      const validation = validateUxTraceBundleArtifact({
        bundleDir,
        expectedLane: story.lane,
        expectedSuite: suite,
      });

      expect(validation.ok).toBe(false);
      if (validation.ok) {
        throw new Error(
          'expected validator to reject a producer-owned trace bundle when manifest.json omits trace_order_contract',
        );
      }
      expect(validation.failureClass).toBe('contract_drift');
      expect(
        validation.issues.some(
          (issue) => issue.failureClass === 'contract_drift' && /trace_order_contract/i.test(issue.message),
        ),
      ).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails validation with contract_drift when manifest trace_order_contract is malformed instead of falling back to local story order', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-ux-trace-order-contract-malformed-'));
    try {
      const story = await loadStoryDefinition('release-user-story-end-to-end');
      const binding = buildTraceStoryBinding(story);
      const suite = 'integration-release-user-story';
      const runId = 'run-malformed-trace-order-contract';
      const trace = await createUxTraceBundleWriter({
        outputRoot: rootDir,
        lane: story.lane,
        suite,
        storyId: story.storyId,
        title: story.title,
        actor: story.actor,
        route: story.entryRoute,
        specFile: 'e2e/integration-release-user-story.spec.ts',
        browser: 'chromium',
        runId,
        startedAt: '2026-04-12T07:03:04.000Z',
        goal: story.goal,
        preconditions: story.preconditions ?? [],
        seedData: story.seedData ?? [],
        storyBinding: binding,
      });

      const requiredTraceSteps = binding.steps.filter((step) => step.evidence.includes('trace') && !step.optional);
      expect(requiredTraceSteps.length).toBeGreaterThan(1);

      for (const step of requiredTraceSteps) {
        await trace.capture(makeFakePage(stepRoute(story, step)), { stepId: step.stepId });
      }

      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T07:04:04.000Z',
      });

      const bundleDir = resolveUxTraceBundleDir({
        outputRoot: rootDir,
        lane: story.lane,
        suite,
        storyId: story.storyId,
        runId,
      });
      const manifestPath = path.join(bundleDir, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
      manifest.trace_order_contract = null;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

      let validation: ReturnType<typeof validateUxTraceBundleArtifact> | undefined;
      expect(() => {
        validation = validateUxTraceBundleArtifact({
          bundleDir,
          expectedLane: story.lane,
          expectedSuite: suite,
        });
      }).not.toThrow();

      expect(validation).toBeDefined();
      expect(validation?.ok).toBe(false);
      if (!validation || validation.ok) {
        throw new Error('expected UX trace bundle validation to fail for malformed manifest trace_order_contract');
      }
      expect(validation.failureClass).toBe('contract_drift');
      expect(validation.message).toMatch(/trace_order_contract/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
