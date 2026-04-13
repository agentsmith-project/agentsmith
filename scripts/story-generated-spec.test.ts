import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllStoryDefinitions } from '../e2e/story-loader';
import {
  buildGeneratedStorySpecs,
  renderGeneratedStorySpecsJson,
} from '../e2e/story-generated-spec';

describe('generated story specs', () => {
  it('derives generated specs from markdown story sources without hand-maintained prose drift', async () => {
    const stories = await loadAllStoryDefinitions();
    const specs = buildGeneratedStorySpecs(stories);

    expect(specs.map((spec) => spec.storyId)).toEqual(stories.map((story) => story.storyId));
    expect(specs.every((spec) => spec.sourceFingerprint.length > 0)).toBe(true);
    expect(specs[0]?.stepIds.length).toBeGreaterThan(0);
    expect(specs[0]?.storyFingerprint.length).toBeGreaterThan(0);
    expect(specs[0]?.stepMapFingerprint.length).toBeGreaterThan(0);
  });

  it('renders generated specs as stable json ordered by story id', async () => {
    const stories = await loadAllStoryDefinitions();
    const json = renderGeneratedStorySpecsJson(buildGeneratedStorySpecs(stories));
    const parsed = JSON.parse(json) as Array<{
      storyId: string;
      stepIds: string[];
    }>;

    const storyIds = parsed.map((entry) => entry.storyId);
    expect(storyIds).toEqual([...storyIds].sort((left, right) => left.localeCompare(right)));
    expect(storyIds).toEqual([
      'api-key-to-endpoint-consumption',
      'chat-conversation-continuity',
      'chat-day-two-thread-workflow',
      'files-crud-and-sync',
      'files-library-access-and-recovery',
      'members-invite-and-chat-privacy',
      'mock-lane-alerts-and-usage-review',
      'mock-lane-chat-operate-and-recover',
      'mock-lane-connections-and-credentials-lifecycle',
      'mock-lane-entry-access',
      'mock-lane-governance-surfaces',
      'mock-lane-notebook-task-lifecycle',
      'mock-lane-self-service',
      'mock-lane-settings-and-members-review',
      'mock-lane-workspace-project-core',
      'notebook-artifact-to-files-download',
      'notebook-first-success',
      'project-governance-onboarding',
      'project-governance-runtime-setup',
      'real-backend-visual-review',
      'release-user-story-end-to-end',
      'system-admin-entry',
      'workspace-entry-and-project-discovery',
      'workspace-project-personal-context',
      'workspace-publish-to-usable-access',
      'workspace-settings-save-and-effect',
    ]);
    expect(parsed.every((entry) => entry.stepIds.length > 0)).toBe(true);
  });

  it('keeps the committed generated cache byte-for-byte aligned with regenerated story specs', async () => {
    const stories = await loadAllStoryDefinitions();
    const regenerated = renderGeneratedStorySpecsJson(buildGeneratedStorySpecs(stories));
    const committed = await readFile(path.resolve('e2e/generated/story-specs.generated.json'), 'utf-8');

    expect(committed).toBe(regenerated);
  });
});
