import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

describe('personal self-service lifecycle story', () => {
  it('defines a backend-real self-service journey around identity and access readiness', () => {
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
    expect(story.goal).not.toContain('/user/profile');
    expect(story.goal).not.toContain('/user/api-keys');
    expect(story.goal).not.toContain('/user/third-party-accounts');

    expect(story.scenes.map((scene) => scene.sceneId)).toEqual([
      'user-profile',
      'personal-connections',
      'user-api-keys',
      'project-use-guide',
    ]);
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'update-personal-profile',
      'create-personal-connection',
      'create-personal-api-key',
      'review-project-access-guide',
      'verify-personal-access-ready',
    ]);
  });

  it('wires the existing backend-real API key gateway spec through the self-service story instead of inline fixture prose', async () => {
    const source = await readFile(path.resolve(process.cwd(), 'e2e/integration-api-key-gateway.spec.ts'), 'utf-8');

    expect(source).toContain("loadStoryDefinitionSync('personal-self-service-lifecycle')");
    expect(source).toContain('buildTraceStoryBinding(PERSONAL_SELF_SERVICE_STORY)');
    expect(source).toContain('function requirePersonalSelfServiceRuntime()');
    expect(source).toContain('updatePersonalProfile');
    expect(source).toContain('createPersonalConnection');
    expect(source).toContain("captureSelfServiceTrace('update-personal-profile')");
    expect(source).toContain("captureSelfServiceTrace('create-personal-connection')");
    expect(source).toContain("captureSelfServiceTrace('create-personal-api-key')");
    expect(source).toContain("captureSelfServiceTrace('review-project-access-guide')");
    expect(source).toContain("captureSelfServiceTrace('verify-personal-access-ready')");
    expect(source).not.toContain('Story Personal Self-Service Display Name');
    expect(source).not.toContain('story-personal-self-service.example.com');
  });
});
