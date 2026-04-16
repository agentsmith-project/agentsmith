import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStoryDefinitionFromMarkdownFileSync } from '../e2e/story-loader';

describe('system/workspace lifecycle stories', () => {
  it('keeps system admin entry focused on entering system workspace administration', () => {
    const story = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/system-admin-entry.story.md');

    expect(story.storyId).toBe('system-admin-entry');
    expect(story.goal).toContain('工作区清单页');
    expect(story.steps.map((step) => step.stepId)).toEqual(['system-login', 'system-workspaces']);
  });

  it('anchors system workspace entry on the current work surface markers', () => {
    const story = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/system-admin-entry.story.md');
    const systemWorkspacesScene = story.scenes.find((scene) => scene.sceneId === 'system-workspaces');
    const systemWorkspacesStep = story.steps.find((step) => step.stepId === 'system-workspaces');

    expect(systemWorkspacesScene?.stableMarkers).toEqual([
      'system-workspaces__list',
      'system-workspaces__new-workspace',
    ]);
    expect(systemWorkspacesStep?.target).toBe('system-workspaces__list');
  });

  it('defines a canonical backend-real story for workspace IdP and admin handoff truth', () => {
    const story = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/workspace-idp-and-admin-handoff.story.md');

    expect(story.storyId).toBe('workspace-idp-and-admin-handoff');
    expect(story.goal).toContain('管理员交接');
    expect(story.goal).toContain('目录用户');
    expect(story.goal).toContain('邮箱待绑定');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'open-system-login',
      'review-directory-backed-handoff',
      'review-email-pending-handoff',
    ]);
  });

  it('keeps publish usability grounded in bootstrap-and-publish truth instead of a bare ready state', () => {
    const story = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/workspace-publish-to-usable-access.story.md');

    expect(story.goal).toContain('发布工作区');
    expect(story.goal).toContain('立刻');
    expect(story.narrative).toContain('bootstrap');
    expect(story.narrative).toContain('admin');
  });

  it('defines a canonical backend-real story for system admins handling multiple workspaces and truthful re-entry later', () => {
    const story = readStoryDefinitionFromMarkdownFileSync(
      'e2e/stories/backend-real/system-admin-multi-workspace-handoff.story.md',
    );

    expect(story.storyId).toBe('system-admin-multi-workspace-handoff');
    expect(story.goal).toContain('多个 workspace');
    expect(story.goal).toContain('真实 workspace admin');
    expect(story.goal).toContain('重新进入');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'open-system-login',
      'bootstrap-workspace-alpha',
      'bootstrap-workspace-beta',
      'review-system-workspaces',
      'reenter-workspace-alpha',
      'reenter-workspace-beta',
    ]);
  });
});

describe('system/workspace lifecycle specs', () => {
  it('wires system admin entry spec to the entry story instead of the live-workspace maintenance story', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'e2e/integration-system-admin-entry.spec.ts'),
      'utf-8',
    );

    expect(source).toContain("loadStoryDefinitionSync('system-admin-entry')");
    expect(source).toContain("loadStoryDefinitionSync('system-admin-multi-workspace-handoff')");
    expect(source).not.toContain('workspace-lifecycle-admin-operations.story.md');
  });

  it('wires workspace publish spec to the workspace idp/admin handoff story for pre-publish truth checks', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'e2e/integration-workspace-publish-usable.spec.ts'),
      'utf-8',
    );

    expect(source).toContain("loadStoryDefinitionSync('workspace-idp-and-admin-handoff')");
  });
});
