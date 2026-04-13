import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

const STORY_FILE = path.resolve(process.cwd(), 'e2e/stories/backend-real/usage-self-scope-review.story.md');

describe('usage self scope review story', () => {
  it('defines a backend-real member journey around understanding personal usage', () => {
    const story = loadStoryDefinitionSync(STORY_FILE);

    expect(story.lane).toBe('backend-real');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(story.actor).toBe('project member');
    expect(story.goal).toContain('自己的 usage');
    expect(story.goal).toContain('我的用量');
    expect(story.goal).not.toContain('owner');
    expect(story.goal).not.toContain('audit');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'generate-self-usage',
      'open-usage-review',
      'review-self-scope-summary',
      'review-endpoint-usage',
    ]);

    const runtime = (story.runtimeData as Record<string, unknown> | undefined)?.usageSelfScope as
      | Record<string, unknown>
      | undefined;
    expect(runtime?.projectNamePrefix).toBeTruthy();
    expect(runtime?.credentialNamePrefix).toBeTruthy();
    expect(runtime?.endpointNamePrefix).toBeTruthy();
    expect(runtime?.model).toBeTruthy();
    expect(runtime?.expectedReplyText).toBeTruthy();
    expect(story.steps[2]?.target).toBe('usage__my-scope-badge');
    expect(story.steps[2]?.expectedFeedback).toContain('只看我自己');
    expect(story.steps[3]?.target).toBe('usage__selected-endpoint');
  });

  it('binds the real-lane usage spec to the member self-scope story instead of the old access-only check', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-usage-self-scope.spec.ts'),
      'utf-8',
    );

    expect(source).toContain('loadStoryDefinitionSync(');
    expect(source).toContain('usage-self-scope-review.story.md');
    expect(source).toContain('buildTraceStoryBinding');
    expect(source).toContain('createUxTraceBundleWriter');
    expect(source).toContain("stepId: 'generate-self-usage'");
    expect(source).toContain("stepId: 'open-usage-review'");
    expect(source).toContain("stepId: 'review-self-scope-summary'");
    expect(source).toContain("stepId: 'review-endpoint-usage'");
    expect(source).toContain('waitForUsageFacts');
    expect(source).not.toContain('different members can open their own usage page');
    expect(source).not.toContain('project-wide access controls');
  });
});
