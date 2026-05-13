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
    expect(story.goal).toContain('Agent Task');
    expect(story.goal).toContain('Agent Task detail');
    expect(story.goal).toContain('artifacts continuity');
    expect(story.narrative).toContain('Agent Task detail');
    expect(story.scenes.map((scene) => scene.sceneId)).toContain('project-agent-task');
    expect(story.scenes.map((scene) => scene.sceneId)).not.toContain('project-files');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'member-first-success',
      'promote-member-and-continue-work',
      'demote-member-and-continue-work',
      'remove-member-and-lose-project-access',
    ]);
  });

  it('defines a backend-real story for an admin switching back to member while keeping work continuity', () => {
    const story = readStoryDefinitionFromMarkdownFileSync(path.resolve(process.cwd(), 'e2e/stories/backend-real/admin-switches-to-member-and-keeps-working.story.md'));

    expect(story.lane).toBe('backend-real');
    expect(story.actor).toContain('project admin');
    expect(story.goal).toContain('降回普通成员');
    expect(story.goal).toContain('agent-task');
    expect(story.goal).toContain('files');
    expect(story.goal).toContain('治理入口要立即收缩');
    expect(story.narrative).toContain('治理面必须收缩');
    expect(story.scenes.map((scene) => scene.sceneId)).toContain('project-settings');
    expect(story.scenes.map((scene) => scene.sceneId)).toContain('project-agent-task');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'confirm-admin-surface',
      'demote-admin-to-member',
      'lose-governance-surface',
      'continue-member-work',
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
    expect(membershipSpec).toContain("loadStoryDefinitionSync('e2e/stories/backend-real/admin-switches-to-member-and-keeps-working.story.md')");
    expect(membershipSpec).not.toContain("loadStoryDefinitionSync('membership-change-and-effective-access')");
    expect(policySpec).toContain("loadStoryDefinitionSync('e2e/stories/backend-real/resource-policy-change-to-observable-effect.story.md')");
    expect(policySpec).not.toContain("open resource policy page");
  });
});
