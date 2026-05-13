import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELEASE_USER_STORY } from '../e2e/release-user-story.contract';
import { loadStoryDefinition } from '../e2e/story-loader';

describe('release-critical story sources', () => {
  it('keeps the release user story in a committed markdown source file', async () => {
    const story = await loadStoryDefinition('release-user-story-end-to-end');

    expect(story.filePath.replace(/\\/g, '/')).toMatch(
      /e2e\/stories\/backend-real\/release-user-story-end-to-end\.story\.md$/,
    );
    expect(story.sourceFile).toBe('e2e/stories/backend-real/release-user-story-end-to-end.story.md');
    expect(story.title).toBe('Release user story end-to-end');
    expect(story.actor).toContain('system 管理侧');
    expect(story.goal).toContain('真实 backend');
    expect(story.seedData).toEqual(['ws_default']);
    expect(RELEASE_USER_STORY.manifest.seedData).toEqual(['ws_default']);
    expect(RELEASE_USER_STORY.manifest.seedData).toEqual(story.seedData);
    expect(story.steps.find((step) => step.stepId === 'system-login')?.note).toBeTruthy();
    expect(story.runtimeData?.agentTask?.managed_create?.turnOne).toMatchObject({
      prompt: expect.stringContaining('MANAGED_T1_OK'),
      expectedToken: 'MANAGED_T1_OK',
      expectedArtifactPath: '.artifacts/managed_summary.md',
    });
    expect(story.steps.map((step) => step.stepId)).toEqual(
      expect.arrayContaining([
        'system-login',
        'workspace-login',
        'project-overview',
      ]),
    );
    expect(story.scenes.find((scene) => scene.sceneId === 'project-agent-runners')?.stableMarkers).toEqual(
      expect.arrayContaining([
        'agent-runners__project-default-status',
        'agent-runners__system-managed-section',
        'agent-runners__system-managed-table',
      ]),
    );
    expect(story.steps.find((step) => step.stepId === 'agent-runners-managed-list')?.target).toBe(
      'agent-runners__system-managed-table',
    );
    expect(story.steps.find((step) => step.stepId === 'agent-runners-managed-health')?.target).toBe(
      'agent-runners__project-default-status',
    );
    expect(story.steps.find((step) => step.stepId === 'files-artifacts-managed')?.note).toContain(
      'workspace/.artifacts',
    );
    expect(story.steps.find((step) => step.stepId === 'files-artifacts-managed-continuity')?.note).toContain(
      'workspace/.artifacts',
    );
    expect(story.steps.find((step) => step.stepId === 'managed-continuity-governance-config')?.note).toContain(
      '项目所有者执行治理配置',
    );
    expect(story.steps.find((step) => step.stepId === 'member-workspace-home-after-governance-config')?.note).toContain(
      '普通成员重新进入 workspace，继续使用托管 Agent Runner',
    );
  });

  it('keeps the backend-real visual review in a committed markdown source file', async () => {
    const story = await loadStoryDefinition('real-backend-visual-review');

    expect(story.filePath.replace(/\\/g, '/')).toMatch(
      /e2e\/stories\/backend-real\/real-backend-visual-review\.story\.md$/,
    );
    expect(story.sourceFile).toBe('e2e/stories/backend-real/real-backend-visual-review.story.md');
    expect(story.steps.map((step) => step.stepId)).toEqual(
      expect.arrayContaining([
        'system-login',
        'workspace-login',
        'project-overview',
        'project-alerts',
      ]),
    );
  });

  it('does not keep canonical story prose embedded in story-contract.ts', async () => {
    const source = await readFile(path.resolve('e2e/story-contract.ts'), 'utf-8');

    expect(source).not.toContain('Release user story end-to-end');
    expect(source).not.toContain('Backend-real visual review');
    expect(source).not.toContain('loadAllStoryDefinitions');
    expect(source).not.toContain('loadStoryDefinition');
  });

  it('keeps release story runtime notes and Agent Task expectations in the markdown story source, not in the accessor module', async () => {
    const source = await readFile(path.resolve('e2e/release-user-story.contract.ts'), 'utf-8');

    expect(source).not.toContain('RELEASE_STORY_NOTES');
  });
});
