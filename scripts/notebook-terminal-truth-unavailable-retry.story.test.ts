import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

const STORY_FILE = path.resolve(
  process.cwd(),
  'e2e/stories/backend-real/notebook-terminal-truth-unavailable-retry.story.md',
);

describe('notebook terminal truth-unavailable retry story', () => {
  it('defines a backend-real journey for explicit retry before terminal truth unlocks the task again', () => {
    const story = loadStoryDefinitionSync(STORY_FILE);

    expect(story.lane).toBe('backend-real');
    expect(story.storyId).toBe('notebook-terminal-truth-unavailable-retry');
    expect(story.family).toBe('notebook-terminal-workspace');
    expect(story.personas).toEqual(['project member']);
    expect(story.kind).toBe('journey');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(story.goal).toContain('terminal 真相');
    expect(story.goal).toContain('fail-closed');
    expect(story.goal).toContain('重试');
    expect(story.goal).toContain('删除');
    expect(story.goal).toContain('运行');
    expect(story.goal).not.toContain('TaskPage');
    expect(story.goal).not.toContain('/terminal/sessions');
    expect(story.goal).not.toContain('TERMINAL_TRUTH_UNAVAILABLE');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'return-to-task-while-terminal-truth-is-unavailable',
      'keep-run-and-delete-fail-closed-while-terminal-truth-is-missing',
      'retry-terminal-truth-check-from-blocked-task',
      'unlock-task-after-terminal-truth-recovers',
    ]);
    expect(story.steps.find((step) => step.stepId === 'return-to-task-while-terminal-truth-is-unavailable')?.target).toBe(
      'notebook__task-header',
    );
    expect(
      story.steps.find((step) => step.stepId === 'keep-run-and-delete-fail-closed-while-terminal-truth-is-missing')
        ?.target,
    ).toBe('notebook__conversation-blocked-state');
    expect(story.steps.find((step) => step.stepId === 'retry-terminal-truth-check-from-blocked-task')?.target).toBe(
      'notebook__conversation-blocked-state',
    );
    expect(story.steps.find((step) => step.stepId === 'unlock-task-after-terminal-truth-recovers')?.target).toBe(
      'notebook__task-header-delete',
    );
  });

  it('binds the truth-unavailable real-lane spec to the canonical story instead of a one-off integration branch', async () => {
    const [storySource, specSource] = await Promise.all([
      readFile(STORY_FILE, 'utf-8'),
      readFile(path.resolve(process.cwd(), 'e2e/integration-notebook-terminal-ux.spec.ts'), 'utf-8'),
    ]);

    expect(storySource).toContain('"storyId": "notebook-terminal-truth-unavailable-retry"');
    expect(storySource).toContain('"family": "notebook-terminal-workspace"');
    expect(storySource).toContain('fail-closed');
    expect(storySource).toContain('重试');
    expect(storySource).not.toContain('TERMINAL_TRUTH_UNAVAILABLE');
    expect(storySource).not.toContain('503');

    expect(specSource).toContain("loadStoryDefinitionSync('notebook-terminal-truth-unavailable-retry')");
    expect(specSource).toContain('buildTraceStoryBinding(NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_STORY)');
    expect(specSource).toContain('createUxTraceBundleWriter');
    expect(specSource).toContain("captureTruthUnavailableTrace(page, 'return-to-task-while-terminal-truth-is-unavailable')");
    expect(specSource).toContain(
      "captureTruthUnavailableTrace(page, 'keep-run-and-delete-fail-closed-while-terminal-truth-is-missing')",
    );
    expect(specSource).toContain("captureTruthUnavailableTrace(page, 'retry-terminal-truth-check-from-blocked-task')");
    expect(specSource).toContain("captureTruthUnavailableTrace(page, 'unlock-task-after-terminal-truth-recovers')");
  });
});
