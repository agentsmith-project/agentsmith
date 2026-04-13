import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStoryDefinitionFromMarkdownFileSync } from '../e2e/story-loader';

describe('governance runtime effect stories', () => {
  it('defines a backend-real story for governance change followed by continued member work', () => {
    const story = readStoryDefinitionFromMarkdownFileSync(path.resolve(process.cwd(), 'e2e/stories/backend-real/governance-change-then-member-keeps-working.story.md'));

    expect(story.lane).toBe('backend-real');
    expect(story.actor).toContain('member');
    expect(story.goal).toContain('治理变更');
    expect(story.goal).toContain('chat');
    expect(story.goal).toContain('notebook');
    expect(story.goal).toContain('notebook task detail');
    expect(story.goal).toContain('artifacts continuity');
    expect(story.narrative).toContain('notebook task detail');
    expect(story.scenes.map((scene) => scene.sceneId)).toContain('project-notebook-task');
    expect(story.scenes.map((scene) => scene.sceneId)).not.toContain('project-files');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'member-first-success',
      'promote-member-and-continue-work',
      'demote-member-and-continue-work',
      'remove-member-and-lose-project-access',
    ]);
  });

  it('defines a backend-real story for resource policy change leading to real capability change', () => {
    const story = readStoryDefinitionFromMarkdownFileSync(path.resolve(process.cwd(), 'e2e/stories/backend-real/resource-policy-change-to-observable-effect.story.md'));

    expect(story.lane).toBe('backend-real');
    expect(story.actor).toContain('project owner');
    expect(story.goal).toContain('resource policy');
    expect(story.goal).toContain('effective access');
    expect(story.goal).toContain('实际可用能力');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'baseline-member-can-use-endpoint',
      'tighten-policy-and-explain-deny',
      'member-hit-policy-denial',
      'reopen-policy-and-restore-use',
    ]);
  });

  it('keeps the focused real specs bound to the canonical governance/runtime effect stories', async () => {
    const membershipSpec = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-governance-member-workflow-continuity.spec.ts'),
      'utf-8',
    );
    const policySpec = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-resource-policy-observable-effect.spec.ts'),
      'utf-8',
    );

    expect(membershipSpec).toContain("loadStoryDefinitionSync('e2e/stories/backend-real/governance-change-then-member-keeps-working.story.md')");
    expect(membershipSpec).not.toContain("loadStoryDefinitionSync('membership-change-and-effective-access')");
    expect(policySpec).toContain("loadStoryDefinitionSync('e2e/stories/backend-real/resource-policy-change-to-observable-effect.story.md')");
    expect(policySpec).not.toContain("open resource policy page");
  });
});
