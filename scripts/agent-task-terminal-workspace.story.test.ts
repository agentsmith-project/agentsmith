import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

const STORY_FILE = path.resolve(
  process.cwd(),
  'e2e/stories/backend-real/agent-task-terminal-workspace-multi-session.story.md',
);

describe('Agent Task terminal workspace multi-session story', () => {
  it('defines a backend-real member journey around terminal workspace tabs, delete blocking, and task release', () => {
    const story = loadStoryDefinitionSync(STORY_FILE);

    expect(story.lane).toBe('backend-real');
    expect(story.storyId).toBe('agent-task-terminal-workspace-multi-session');
    expect(story.family).toBe('agent-task-terminal-workspace');
    expect(story.personas).toEqual(['project member']);
    expect(story.kind).toBe('journey');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(story.goal).toContain('继续工作');
    expect(story.goal).toContain('Terminal workspace');
    expect(story.goal).toContain('多个');
    expect(story.goal).toContain('刷新');
    expect(story.goal).toContain('释放');
    expect(story.goal).toContain('删除');
    expect(story.goal).toContain('第四');
    expect(story.goal).toContain('session id');
    expect(story.goal).not.toContain('TaskTerminalPanel');
    expect(story.goal).not.toContain('terminal/sessions');
    expect(story.goal).not.toContain('hide/show');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'return-to-agent-task',
      'open-terminal-workspace',
      'wait-for-first-terminal-session',
      'create-second-terminal-session',
      'create-third-terminal-session',
      'keep-task-delete-blocked-while-live-terminal-sessions-exist',
      'reject-phantom-fourth-terminal-session',
      'switch-between-terminal-sessions',
      'return-to-conversation-while-terminal-stays-active',
      'reload-task-and-preserve-backend-session-ids',
      'reject-new-run-while-live-terminal-sessions-exist',
      'reopen-terminal-workspace-after-reload',
      'end-one-terminal-session-without-disrupting-others',
      'end-last-terminal-session-and-resume-agent-work',
    ]);
    expect(story.steps.find((step) => step.stepId === 'create-second-terminal-session')?.target).toBe(
      'agent-tasks__task-terminal-create',
    );
    expect(story.steps.find((step) => step.stepId === 'open-terminal-workspace')?.target).toBe(
      'agent-tasks__task-terminal-workspace',
    );
    expect(story.steps.find((step) => step.stepId === 'create-third-terminal-session')?.target).toBe(
      'agent-tasks__task-terminal-create',
    );
    expect(
      story.steps.find((step) => step.stepId === 'keep-task-delete-blocked-while-live-terminal-sessions-exist')?.target,
    ).toBe('agent-task__task-header-actions');
    expect(story.steps.find((step) => step.stepId === 'reject-phantom-fourth-terminal-session')?.target).toBe(
      'agent-tasks__task-terminal-create',
    );
    expect(story.steps.find((step) => step.stepId === 'return-to-conversation-while-terminal-stays-active')?.target).toBe(
      'agent-task__task-header-mode-conversation',
    );
    expect(story.steps.find((step) => step.stepId === 'reload-task-and-preserve-backend-session-ids')?.target).toBe(
      'agent-tasks__task-terminal-status-strip',
    );
    expect(
      story.steps.find((step) => step.stepId === 'reload-task-and-preserve-backend-session-ids')?.expectedFeedback,
    ).toContain('需要恢复处理');
    expect(
      story.steps.find((step) => step.stepId === 'reload-task-and-preserve-backend-session-ids')?.expectedFeedback,
    ).toContain('同一批 session id');
  });

  it('binds the Agent Task terminal real-lane spec to the current route and terminal workspace targets', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-agent-task-terminal-ux.spec.ts'),
      'utf-8',
    );

    expect(source).toContain('/agent-tasks/${prepared.taskId}');
    expect(source).toContain("page.getByTestId('agent-task__task-header-mode-terminal').click()");
    expect(source).toContain("page.getByTestId('agent-tasks__task-terminal-workspace')");
    expect(source).toContain("page.getByTestId('agent-tasks__task-terminal-create')");
    expect(source).not.toContain('/notebook');
    expect(source).not.toContain('notebook__');
  });
});
