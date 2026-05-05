import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

const STORY_FILE = path.resolve(
  process.cwd(),
  'e2e/stories/backend-real/agent-task-terminal-reentry-recovery.story.md',
);

describe('Agent Task terminal re-entry recovery story', () => {
  it('defines a backend-real journey for fail-closed hydration and same-task terminal recovery', () => {
    const story = loadStoryDefinitionSync(STORY_FILE);

    expect(story.lane).toBe('backend-real');
    expect(story.storyId).toBe('agent-task-terminal-reentry-recovery');
    expect(story.family).toBe('agent-task-terminal-workspace');
    expect(story.personas).toEqual(['project member']);
    expect(story.kind).toBe('journey');
    expect(story.goal).toContain('重新进入');
    expect(story.goal).toContain('fail-closed');
    expect(story.goal).toContain('同一 task');
    expect(story.goal).toContain('恢复');
    expect(story.goal).toContain('删除');
    expect(story.goal).toContain('session id');
    expect(story.goal).toContain('需要恢复');
    expect(story.goal).not.toContain('/definitely/not-a-real-shell');
    expect(story.goal).not.toContain('No such file or directory');
    expect(story.goal).not.toContain('Terminal session closed.');
    expect(story.goal).not.toContain('TaskTerminalPanel');
    expect(story.goal).not.toContain('WebSocket');
    expect(story.goal).not.toContain('/terminal/sessions');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'return-to-interrupted-agent-task',
      'lose-terminal-connection-without-ending-task',
      'reload-task-and-fail-closed-on-recovery-needed-terminal',
      'keep-create-run-and-delete-fail-closed-until-terminal-truth-recovers',
      'reopen-terminal-workspace-and-reconnect-existing-session',
      'confirm-reconnected-terminal-is-still-usable',
      'surface-broken-terminal-session-inside-same-task',
      'clear-broken-session-and-keep-task-owned',
      'start-fresh-terminal-session-after-recovery',
      'end-recovered-terminal-session-and-return-to-agent-work',
    ]);
    expect(story.steps.find((step) => step.stepId === 'reload-task-and-fail-closed-on-recovery-needed-terminal')?.target).toBe(
      'agent-tasks__task-terminal-status-strip',
    );
    expect(
      story.steps.find((step) => step.stepId === 'keep-create-run-and-delete-fail-closed-until-terminal-truth-recovers')
        ?.target,
    ).toBe('agent-task__task-header');
    expect(story.steps.find((step) => step.stepId === 'reopen-terminal-workspace-and-reconnect-existing-session')?.target).toBe(
      'agent-tasks__task-terminal-status-strip',
    );
    expect(story.steps.find((step) => step.stepId === 'clear-broken-session-and-keep-task-owned')?.target).toBe(
      'agent-tasks__task-terminal-workspace',
    );
    expect(story.steps.find((step) => step.stepId === 'surface-broken-terminal-session-inside-same-task')?.action).toContain(
      'needs recovery',
    );
    expect(story.steps.find((step) => step.stepId === 'surface-broken-terminal-session-inside-same-task')?.action).not.toContain(
      'failed terminal session',
    );
    expect(story.steps.find((step) => step.stepId === 'clear-broken-session-and-keep-task-owned')?.action).toContain(
      'needs recovery',
    );
    expect(story.steps.find((step) => step.stepId === 'clear-broken-session-and-keep-task-owned')?.action).not.toContain(
      'failed terminal session',
    );
  });

  it('keeps the story definition and spec product-facing instead of centering runner internals', async () => {
    const [source, specSource] = await Promise.all([
      readFile(STORY_FILE, 'utf-8'),
      readFile(path.resolve(process.cwd(), 'e2e/integration-agent-task-terminal-ux.spec.ts'), 'utf-8'),
    ]);

    expect(source).toContain('"storyId": "agent-task-terminal-reentry-recovery"');
    expect(source).toContain('"family": "agent-task-terminal-workspace"');
    expect(source).toContain('fail-closed');
    expect(source).toContain('需要恢复');
    expect(source).not.toContain('failed terminal');
    expect(source).not.toContain('failed-session cleanup');
    expect(source).not.toContain('TaskTerminalPanel');
    expect(source).not.toContain('new WebSocket(');
    expect(source).not.toContain('/definitely/not-a-real-shell');
    expect(source).not.toContain('No such file or directory');
    expect(source).not.toContain('Terminal session closed.');

    expect(specSource).toContain('/agent-tasks/${prepared.taskId}');
    expect(specSource).toContain("page.getByTestId('agent-task__task-header-mode-terminal').click()");
    expect(specSource).toContain("page.getByTestId('agent-tasks__task-terminal-workspace')");
    expect(specSource).toContain("page.getByTestId('agent-tasks__task-terminal-create')");
    expect(specSource).not.toContain('recoverableSocket.closeBrowser()');
    expect(specSource).not.toContain('connectTerminalSocket(');
    expect(specSource).not.toContain("toContainText('/definitely/not-a-real-shell')");
    expect(specSource).not.toContain("toContainText('No such file or directory')");
    expect(specSource).not.toContain("toContainText('Terminal session closed.')");
  });
});
