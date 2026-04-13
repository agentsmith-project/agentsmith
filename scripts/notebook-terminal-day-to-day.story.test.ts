import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

const STORY_FILE = path.resolve(
  process.cwd(),
  'e2e/stories/backend-real/notebook-terminal-day-to-day-and-recovery.story.md',
);

describe('notebook terminal day-to-day and recovery story', () => {
  it('defines a backend-real member journey around continuing work through warmup and recovery', () => {
    const story = loadStoryDefinitionSync(STORY_FILE);

    expect(story.lane).toBe('backend-real');
    expect(story.family).toBe('notebook-terminal-day-to-day');
    expect(story.personas).toEqual(['project member']);
    expect(story.kind).toBe('journey');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(story.goal).toContain('继续工作');
    expect(story.goal).toContain('恢复');
    expect(story.goal).toContain('隐藏');
    expect(story.goal).not.toContain('TaskTerminalPanel');
    expect(story.goal).not.toContain('terminal/sessions');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'return-to-notebook-task',
      'open-terminal-for-follow-up-work',
      'stay-oriented-during-runner-warmup',
      'hide-terminal-without-ending-session',
      'show-hidden-terminal-session',
      'end-terminal-session-before-new-run',
      'see-clear-terminal-recovery-guidance',
      'recover-terminal-after-guidance',
    ]);
  });

  it('binds the notebook terminal real-lane spec to the story and recovery trace steps', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-notebook-terminal-ux.spec.ts'),
      'utf-8',
    );

    expect(source).toContain("loadStoryDefinitionSync('notebook-terminal-day-to-day-and-recovery')");
    expect(source).toContain('buildTraceStoryBinding(NOTEBOOK_TERMINAL_STORY)');
    expect(source).toContain('createUxTraceBundleWriter');
    expect(source).toContain("captureTerminalTrace(page, 'return-to-notebook-task')");
    expect(source).toContain("captureTerminalTrace(page, 'open-terminal-for-follow-up-work')");
    expect(source).toContain("captureTerminalTrace(page, 'stay-oriented-during-runner-warmup')");
    expect(source).toContain("captureTerminalTrace(page, 'hide-terminal-without-ending-session')");
    expect(source).toContain("captureTerminalTrace(page, 'show-hidden-terminal-session')");
    expect(source).toContain("captureTerminalTrace(page, 'end-terminal-session-before-new-run')");
    expect(source).toContain('Terminal session still active');
    expect(source).toContain("captureTerminalTrace(page, 'see-clear-terminal-recovery-guidance')");
    expect(source).toContain("captureTerminalTrace(page, 'recover-terminal-after-guidance')");
    expect(source).toContain('End Session');
    expect(source).not.toContain('Close failed terminal');
    expect(source).not.toContain('Close this terminal, then reopen it from the task header when you are ready to retry.');
  });
});
