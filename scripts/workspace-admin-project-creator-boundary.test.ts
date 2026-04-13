import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCommittedStoryDefinitionByIdSync } from './story-catalog-support';

describe('workspace admin / project creator boundary story', () => {
  it('defines a backend-real story for delegated project creation without workspace admin inheritance', () => {
    const story = loadCommittedStoryDefinitionByIdSync('workspace-admin-boundary-and-project-creator');

    expect(story.lane).toBe('backend-real');
    expect(story.entryRoute).toBe('/en-US/workspaces/ws_default/settings');
    expect(story.goal).toContain('project creator');
    expect(story.goal).toContain('workspace admin');
    expect(story.goal).toContain('不能');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'open-workspace-creator-management',
      'save-project-creator',
      'creator-project-entry',
      'creator-workspace-boundary',
      'creator-create-project',
    ]);
  });

  it('keeps workspace entry/discovery scoped to workspace admin instead of reusing project creator semantics', () => {
    const story = loadCommittedStoryDefinitionByIdSync('workspace-entry-and-project-discovery');

    expect(story.actor).toBe('workspace admin');
    expect(story.personas).toEqual(['workspace admin']);
    expect(story.goal).not.toContain('project creator');
  });

  it('makes the governance matrix spec consume the dedicated boundary story instead of mixing it into onboarding', async () => {
    const specSource = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-workspace-project-governance-matrix.spec.ts'),
      'utf-8',
    );

    expect(specSource).toContain("loadStoryDefinitionSync('workspace-admin-boundary-and-project-creator')");
    expect(specSource).toContain('WORKSPACE_ADMIN_BOUNDARY_STORY');
    expect(specSource).toContain('ensureWorkspaceProjectCreatorViaUi');
    expect(specSource).toContain("stepId: 'creator-workspace-boundary'");
  });
});
