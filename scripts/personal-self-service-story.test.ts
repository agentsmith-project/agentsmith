import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

describe('personal self-service lifecycle story', () => {
  it('defines a backend-real self-service journey that returns to project work after personal setup is complete', () => {
    const story = loadStoryDefinitionSync('personal-self-service-lifecycle');

    expect(story.family).toBe('personal-self-service');
    expect(story.personas).toEqual(expect.arrayContaining(['workspace member', 'project member']));
    expect(story.kind).toBe('journey');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(story.goal).toContain('个人身份');
    expect(story.goal).toContain('访问能力');
    expect(story.goal).toContain('personal context');
    expect(story.goal).toContain('继续工作');
    expect(story.goal).not.toContain('/user/profile');
    expect(story.goal).not.toContain('/user/api-keys');
    expect(story.goal).not.toContain('/user/third-party-accounts');

    expect(story.scenes.map((scene) => scene.sceneId)).toEqual([
      'user-profile',
      'personal-connections',
      'user-api-keys',
      'workspace-personal-context',
      'project-personal-context',
      'project-use-guide',
    ]);
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'update-personal-profile',
      'create-personal-connection',
      'create-personal-api-key',
      'open-workspace-personal-context',
      'save-workspace-personal-context',
      'open-project-personal-context',
      'save-project-personal-context',
      'review-project-access-guide',
      'verify-personal-access-ready',
    ]);

    const runtime = story.runtimeData?.personalSelfServiceLifecycle as Record<string, unknown> | undefined;
    expect(runtime?.personalContextKey).toBeTruthy();
    expect(runtime?.workspacePersonalContextValue).toBeTruthy();
    expect(runtime?.projectPersonalContextValue).toBeTruthy();
  });

  it('wires the backend-real API key gateway spec through the self-service and personal-context flow instead of inline fixture prose', async () => {
    const source = await readFile(path.resolve(process.cwd(), 'e2e/integration-api-key-gateway.spec.ts'), 'utf-8');

    expect(source).toContain("loadStoryDefinitionSync('personal-self-service-lifecycle')");
    expect(source).toContain('buildTraceStoryBinding(PERSONAL_SELF_SERVICE_STORY)');
    expect(source).toContain('function requirePersonalSelfServiceRuntime()');
    expect(source).toContain('updatePersonalProfile');
    expect(source).toContain('createPersonalConnection');
    expect(source).toContain('openPersonalContextFromUserMenu');
    expect(source).toContain('saveContextEntryViaUi');
    expect(source).toContain("captureSelfServiceTrace('open-workspace-personal-context')");
    expect(source).toContain("captureSelfServiceTrace('save-workspace-personal-context')");
    expect(source).toContain("captureSelfServiceTrace('open-project-personal-context')");
    expect(source).toContain("captureSelfServiceTrace('save-project-personal-context')");
    expect(source).toContain("captureSelfServiceTrace('review-project-access-guide')");
    expect(source).toContain("captureSelfServiceTrace('verify-personal-access-ready')");
    expect(source).not.toContain('Story Personal Self-Service Display Name');
    expect(source).not.toContain('story-personal-self-service.example.com');
  });
});
