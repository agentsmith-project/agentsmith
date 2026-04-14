import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

const STORY_FILE = path.resolve(
  process.cwd(),
  'e2e/stories/backend-real/notebook-terminal-workspace-multi-session.story.md',
);

describe('notebook terminal workspace multi-session story', () => {
  it('defines a backend-real member journey around terminal workspace tabs, delete blocking, and task release', () => {
    const story = loadStoryDefinitionSync(STORY_FILE);

    expect(story.lane).toBe('backend-real');
    expect(story.storyId).toBe('notebook-terminal-workspace-multi-session');
    expect(story.family).toBe('notebook-terminal-workspace');
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
      'return-to-notebook-task',
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
      'notebook__task-terminal-create',
    );
    expect(story.steps.find((step) => step.stepId === 'create-third-terminal-session')?.target).toBe(
      'notebook__task-terminal-create',
    );
    expect(
      story.steps.find((step) => step.stepId === 'keep-task-delete-blocked-while-live-terminal-sessions-exist')?.target,
    ).toBe('notebook__task-header-delete');
    expect(story.steps.find((step) => step.stepId === 'reject-phantom-fourth-terminal-session')?.target).toBe(
      'notebook__task-terminal-create',
    );
    expect(story.steps.find((step) => step.stepId === 'return-to-conversation-while-terminal-stays-active')?.target).toBe(
      'notebook__task-header-mode-conversation',
    );
    expect(story.steps.find((step) => step.stepId === 'reload-task-and-preserve-backend-session-ids')?.target).toBe(
      'notebook__task-terminal-status-strip',
    );
    expect(
      story.steps.find((step) => step.stepId === 'reload-task-and-preserve-backend-session-ids')?.expectedFeedback,
    ).toContain('需要恢复处理');
    expect(
      story.steps.find((step) => step.stepId === 'reload-task-and-preserve-backend-session-ids')?.expectedFeedback,
    ).toContain('同一批 session id');
  });

  it('binds the notebook terminal real-lane spec to the story and terminal workspace trace steps', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-notebook-terminal-ux.spec.ts'),
      'utf-8',
    );

    expect(source).toContain("loadStoryDefinitionSync('notebook-terminal-workspace-multi-session')");
    expect(source).toContain('buildTraceStoryBinding(NOTEBOOK_TERMINAL_STORY)');
    expect(source).toContain('createUxTraceBundleWriter');
    expect(source).toContain("captureTerminalTrace(page, 'return-to-notebook-task')");
    expect(source).toContain("captureTerminalTrace(page, 'open-terminal-workspace')");
    expect(source).toContain("captureTerminalTrace(page, 'wait-for-first-terminal-session')");
    expect(source).toContain("captureTerminalTrace(page, 'create-second-terminal-session')");
    expect(source).toContain("captureTerminalTrace(page, 'switch-between-terminal-sessions')");
    expect(source).toContain("captureTerminalTrace(page, 'return-to-conversation-while-terminal-stays-active')");
    expect(source).toContain("captureTerminalTrace(page, 'reload-task-and-preserve-backend-session-ids')");
    expect(source).toContain("captureTerminalTrace(page, 'reject-new-run-while-live-terminal-sessions-exist')");
    expect(source).toContain("captureTerminalTrace(page, 'reopen-terminal-workspace-after-reload')");
    expect(source).toContain("captureTerminalTrace(page, 'end-one-terminal-session-without-disrupting-others')");
    expect(source).toContain("captureTerminalTrace(page, 'end-last-terminal-session-and-resume-agent-work')");
    expect(source).toContain('page.reload({ waitUntil: ');
    expect(source).toContain("message: 'task_terminal_sessions_active'");
    expect(source).toContain('notebook__task-terminal-workspace');
    expect(source).toContain('notebook__task-terminal-status-strip');
    expect(source).toContain('Open Terminal Workspace');
    expect(source).toContain('Reopen Terminal Workspace');
    expect(source).toContain('End All Sessions');
    expect(source).toContain('notebook__task-terminal-close-');
    expect(source).toContain('const activeTabIdBeforeClose = await getActiveTerminalTabId(page);');
    expect(source).toContain("statusStrip.getByRole('button', { name: 'End All Sessions' }).click()");
    expect(source).not.toContain("captureTerminalTrace(page, 'reload-task-and-restore-terminal-truth')");
    expect(source).not.toContain('Terminal session still active');
    expect(source).not.toContain('Show the hidden terminal session again');
  });
});
