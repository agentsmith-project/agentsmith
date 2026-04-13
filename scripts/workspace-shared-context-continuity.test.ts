import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStoryDefinitionFromMarkdownFileSync } from '../e2e/story-loader';

describe('workspace shared context continuity story', () => {
  it('defines a backend-real governance story for workspace shared context continuity', () => {
    const story = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/workspace-shared-context-continuity.story.md');

    expect(story.storyId).toBe('workspace-shared-context-continuity');
    expect(story.family).toBe('workspace-shared-context');
    expect(story.kind).toBe('journey');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(story.goal).toContain('shared context');
    expect(story.goal).toContain('治理');
    expect(story.goal).toContain('继续');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'open-workspace-shared-context',
      'save-workspace-shared-context',
      'verify-member-shared-context-boundary',
      'verify-member-private-context-boundary',
    ]);
  });

  it('binds the backend-real context isolation spec to the workspace shared context story instead of a raw API-only check', async () => {
    const source = await readFile(path.resolve(process.cwd(), 'e2e/integration-context-store-isolation.spec.ts'), 'utf-8');

    expect(source).toContain("readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/workspace-shared-context-continuity.story.md')");
    expect(source).toContain('buildTraceStoryBinding(WORKSPACE_SHARED_CONTEXT_STORY)');
    expect(source).toContain('saveContextEntryViaUi');
    expect(source).toContain("captureSharedContextTrace('open-workspace-shared-context')");
    expect(source).toContain("captureSharedContextTrace('save-workspace-shared-context')");
    expect(source).toContain("captureSharedContextTrace('verify-member-shared-context-boundary')");
  });
});
