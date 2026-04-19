import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

describe('invite to first effective work story', () => {
  it('defines a backend-real invited-member journey from public invite truth through direct workspace login and first work', () => {
    const story = loadStoryDefinitionSync('invite-to-first-effective-work');
    const startFirstChatWorkStep = story.steps.find((step) => step.stepId === 'start-first-chat-work');

    expect(story.lane).toBe('backend-real');
    expect(story.family).toBe('invite-first-effective-work');
    expect(story.personas).toEqual(['project owner', 'invitee member']);
    expect(story.kind).toBe('journey');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(story.goal).toContain('公开 invite 真相');
    expect(story.goal).toContain('已经登录');
    expect(story.goal).toContain('workspace 的登录入口');
    expect(story.goal).toContain('overview');
    expect(story.goal).toContain('第一次有效工作');
    expect(story.goal).not.toContain('工作区选择入口');
    expect(story.goal).not.toContain('workspace selection');

    expect(story.scenes.map((scene) => scene.sceneId)).toEqual([
      'join-invite',
      'invited-workspace-login',
      'project-overview',
      'project-chat',
    ]);
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'inspect-invite-truth',
      'continue-to-invited-workspace-login',
      'complete-workspace-login-and-accept',
      'land-on-invited-project-overview',
      'start-first-chat-work',
      'verify-private-chat-boundary',
    ]);
    expect(startFirstChatWorkStep?.sceneId).toBe('project-overview');
    expect(startFirstChatWorkStep?.target).toBe('project-overview__primary-cta');
  });

  it('wires the focused invite story spec to the canonical story and trace binding', async () => {
    const source = await readFile(path.resolve(process.cwd(), 'e2e/integration-invite-first-effective-work.spec.ts'), 'utf-8');
    const startFirstChatWorkTraceIndex = source.indexOf("captureInviteTrace(memberPage, 'start-first-chat-work');");
    const firstChatClickIndex = source.indexOf("memberPage.getByTestId('project-overview__primary-cta').click();");

    expect(source).toContain("loadStoryDefinitionSync('invite-to-first-effective-work')");
    expect(source).toContain('buildTraceStoryBinding(STORY)');
    expect(source).toContain('createUxTraceBundleWriter');
    expect(source).toContain('join__invite-card');
    expect(source).toContain('join__invite-workspace');
    expect(source).toContain('join__invite-project');
    expect(source).toContain('join__continue-btn');
    expect(source).toContain('workspace-login__heading');
    expect(source).toContain('workspace-login__keycloak-btn');
    expect(source).toContain('project-overview__page');
    expect(source).toContain('project-overview__primary-cta');
    expect(source).toContain('verify-private-chat-boundary');
    expect(source).not.toContain('project-hub__page');
    expect(source).not.toContain('project-hub__next-step--chat');
    expect(source).not.toContain('workspace-select__list');
    expect(source).not.toContain('workspace-select__item--ws_default');
    expect(source).not.toContain('workspace-selection');
    expect(source).not.toContain('discover-invited-project');
    expect(source).not.toContain('workspace public entry and login truth');
    expect(startFirstChatWorkTraceIndex).toBeGreaterThan(-1);
    expect(firstChatClickIndex).toBeGreaterThan(-1);
    expect(startFirstChatWorkTraceIndex).toBeLessThan(firstChatClickIndex);
  });
});
