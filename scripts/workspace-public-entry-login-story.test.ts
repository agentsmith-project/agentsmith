import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCommittedStoryDefinitionByIdSync } from './story-catalog-support';

describe('workspace public entry and login story', () => {
  it('defines a real-lane story around public workspace selection and workspace-specific login truth', () => {
    const story = loadCommittedStoryDefinitionByIdSync('workspace-public-entry-and-login-truth');

    expect(story.lane).toBe('backend-real');
    expect(story.actor).toContain('member');
    expect(story.goal).toContain('正确工作区');
    expect(story.goal).toContain('下一步');
    expect(story.entryRoute).toBe('/en-US/login/workspace');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'workspace-selection',
      'workspace-login-identity',
      'workspace-login-next-step',
    ]);
    expect(story.steps.find((step) => step.stepId === 'workspace-login-next-step')?.target).toBe(
      'workspace-login__keycloak-btn',
    );
  });

  it('makes the public login spec consume the canonical story instead of keeping a metadata smoke test', async () => {
    const specSource = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-workspace-public-login.spec.ts'),
      'utf-8',
    );

    expect(specSource).toContain("loadStoryDefinitionSync('workspace-public-entry-and-login-truth')");
    expect(specSource).toContain('buildTraceStoryBinding');
    expect(specSource).toContain('createUxTraceBundleWriter');
    expect(specSource).not.toContain('workspace public metadata and login page expose the same workspace identity');
  });
});
