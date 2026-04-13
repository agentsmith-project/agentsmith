import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

describe('desktop auth request complete work story', () => {
  it('defines a backend-real story about completing the desktop handoff and continuing into real work', () => {
    const story = loadStoryDefinitionSync('desktop-auth-request-complete-and-work');

    expect(story.lane).toBe('backend-real');
    expect(story.family).toBe('desktop-auth-request-complete-and-work');
    expect(story.personas).toEqual(['workspace member', 'desktop user']);
    expect(story.kind).toBe('journey');
    expect(story.goal).toContain('桌面');
    expect(story.goal).toContain('继续开始工作');
    expect(story.goal).toContain('完成');
    expect(story.goal).not.toContain('poll_url');
    expect(story.goal).not.toContain('exchange_ticket');
    expect(story.goal).not.toContain('sessionStorage');

    expect(story.scenes.map((scene) => scene.sceneId)).toEqual([
      'desktop-auth-request',
      'desktop-auth-complete',
      'workspace-selection',
      'workspace-login',
      'workspace-entry',
    ]);
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'desktop-auth-request',
      'desktop-auth-complete',
      'workspace-selection',
      'workspace-login',
      'workspace-entry',
    ]);
  });

  it('wires the desktop auth pages and visual lane to the story instead of hiding the handoff inside other journeys', async () => {
    const requestPage = await readFile(
      path.resolve(process.cwd(), 'src/app/[locale]/desktop/auth/request/page.tsx'),
      'utf-8',
    );
    const completePage = await readFile(
      path.resolve(process.cwd(), 'src/app/[locale]/desktop/auth/complete/page.tsx'),
      'utf-8',
    );
    const visualSpec = await readFile(path.resolve(process.cwd(), 'e2e/visual.spec.ts'), 'utf-8');

    expect(requestPage).toContain('desktop-auth-request__title');
    expect(requestPage).toContain('workspaceLoginHref');
    expect(completePage).toContain('desktop-auth-complete__workspace-entry-link');
    expect(visualSpec).toContain("name: 'desktop-auth-request'");
    expect(visualSpec).toContain("name: 'desktop-auth-complete'");
    expect(visualSpec).not.toContain('desktop-auth-request-metadata-smoke');
  });
});
