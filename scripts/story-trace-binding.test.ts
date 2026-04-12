import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinition } from '../e2e/story-loader';
import { buildTraceStoryBinding, bindTraceEventToStory } from '../e2e/story-trace-binding';
import {
  createUxTraceBundleWriter,
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

describe('story trace binding', () => {
  it('builds stable story and step-map fingerprints from markdown story sources', async () => {
    const story = await loadStoryDefinition('release-user-story-end-to-end');
    const binding = buildTraceStoryBinding(story);

    expect(binding.storyId).toBe('release-user-story-end-to-end');
    expect(binding.storyFingerprint.length).toBeGreaterThan(0);
    expect(binding.stepMapFingerprint.length).toBeGreaterThan(0);
    expect(binding.steps.map((step) => step.stepId)).toContain('system-login');
  });

  it('fills missing action and target from the story step contract and rejects unknown step ids', async () => {
    const story = await loadStoryDefinition('release-user-story-end-to-end');
    const binding = buildTraceStoryBinding(story);

    expect(
      bindTraceEventToStory(binding, {
        stepId: 'system-login',
      }),
    ).toMatchObject({
      stepId: 'system-login',
      action: 'Open system login',
      target: 'system-login__heading',
      note: 'system 管理侧登录入口',
    });

    expect(() =>
      bindTraceEventToStory(binding, {
        stepId: 'unknown-step',
      }),
    ).toThrow(/unknown story step/i);
  });

  it('writes story fingerprint metadata into trace manifests when a story binding is provided', async () => {
    const story = await loadStoryDefinition('release-user-story-end-to-end');
    const binding = buildTraceStoryBinding(story);
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentsmith-story-trace-'));

    try {
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
        storyBinding: binding,
      });

      await trace.capture(makeFakePage(story.entryRoute), {
        stepId: 'system-login',
      });

      await trace.finish({
        outcome: 'pass',
        finishedAt: '2026-04-12T10:00:00.000Z',
      });

      const manifestPath = path.join(trace.bundleDir, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as {
        story_fingerprint?: string;
        step_map_fingerprint?: string;
        story_source?: string;
      };
      expect(manifest.story_fingerprint).toBe(binding.storyFingerprint);
      expect(manifest.step_map_fingerprint).toBe(binding.stepMapFingerprint);
      expect(manifest.story_source?.length).toBeGreaterThan(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
