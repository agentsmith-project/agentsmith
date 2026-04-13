import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

describe('use-guide first consumption story', () => {
  it('defines a backend-real story for a member learning the guide and making the first correct consumption', () => {
    const story = loadStoryDefinitionSync('use-guide-first-consumption');

    expect(story.lane).toBe('backend-real');
    expect(story.family).toBe('use-guide-first-consumption');
    expect(story.personas).toEqual(['project member']);
    expect(story.kind).toBe('journey');
    expect(story.goal).toContain('第一次');
    expect(story.goal).toContain('正确消费');
    expect(story.goal).toContain('use-guide');
    expect(story.goal).not.toContain('query string');
    expect(story.goal).not.toContain('debug');

    expect(story.scenes.map((scene) => scene.sceneId)).toEqual([
      'project-use-guide',
      'personal-api-keys',
      'project-endpoints',
    ]);
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'open-use-guide',
      'verify-use-guide-readiness',
      'choose-first-usable-endpoint',
      'create-personal-api-key',
      'consume-project-endpoint',
      'verify-first-consumption',
    ]);
  });

  it('wires the dedicated use guide spec to the story instead of letting api-key access carry the whole journey', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-use-guide-first-consumption.spec.ts'),
      'utf-8',
    );

    expect(source).toContain("loadStoryDefinitionSync('use-guide-first-consumption')");
    expect(source).toContain('buildTraceStoryBinding');
    expect(source).toContain('createUxTraceBundleWriter');
    expect(source).toContain('use-guide__endpoint-select');
    expect(source).toContain('api-keys__create-btn');
    expect(source).toContain('use-guide__gateway-base-url');
    expect(source).not.toContain('api-key-to-endpoint-consumption');
  });
});
