import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStorySourceFingerprint } from '../e2e/story-contract';
import { loadStoryDefinition } from '../e2e/story-loader';
import {
  createUxTraceBundleWriter,
  buildUxTraceCaptureEvent,
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
      const eventsPath = path.join(bundleDir, 'events.jsonl');
      const reviewPath = path.join(bundleDir, 'review.md');
      const firstScreenshot = path.join(bundleDir, 'screenshots', '001-system-login.png');
      const secondScreenshot = path.join(bundleDir, 'screenshots', '002-workspace-login.png');

      await expect(readFile(manifestPath, 'utf-8')).resolves.toContain('"story_id": "workspace-provisioning"');
      await expect(readFile(manifestPath, 'utf-8')).resolves.toContain('"screenshot_count": 2');
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
});
