import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStoryDefinitionFromMarkdownFileSync } from '../e2e/story-loader';

const PROJECT_MEMBER_TEMPLATE_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent:use',
  'project:terminal:use',
];

const PROJECT_ADMIN_TEMPLATE_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent:use',
  'project:terminal:use',
  'project:agent:manage',
  'project:agent:public',
  'project:audit:read',
  'project:governance:update',
  'project:membership:update',
  'project:admins:update',
  'project:files:update',
];

describe('membership change and effective access story', () => {
  it('uses real project member and project admin template permissions as effective-access truth', () => {
    const story = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/membership-change-and-effective-access.story.md');
    const runtime = story.runtimeData?.membershipChange as
      | {
          joinedMemberPermissions?: string[];
          promotedMemberPermissions?: string[];
        }
      | undefined;

    expect(runtime?.joinedMemberPermissions).toEqual(PROJECT_MEMBER_TEMPLATE_PERMISSIONS);
    expect(runtime?.promotedMemberPermissions).toEqual(PROJECT_ADMIN_TEMPLATE_PERMISSIONS);

    const openStep = story.steps.find((step) => step.stepId === 'open-member-effective-access');
    const promoteStep = story.steps.find((step) => step.stepId === 'promote-member-admin');
    const reopenStep = story.steps.find((step) => step.stepId === 'reopen-member-effective-access-after-promotion');
    const demoteStep = story.steps.find((step) => step.stepId === 'demote-member-back');
    const removedStep = story.steps.find((step) => step.stepId === 'verify-removed-access');

    expect(openStep?.expectedFeedback).toContain('Project Members');
    expect(openStep?.expectedFeedback).toContain('member template permissions');
    expect(promoteStep?.expectedFeedback).toContain('Project Admins');
    expect(promoteStep?.expectedFeedback).toContain('admin template permissions');
    expect(reopenStep?.expectedFeedback).toContain('Project Admins');
    expect(reopenStep?.expectedFeedback).toContain('admin template permissions');
    expect(demoteStep?.expectedFeedback).toContain('Project Members');
    expect(demoteStep?.expectedFeedback).toContain('member template permissions');
    expect(removedStep?.expectedFeedback).toContain('Project unavailable');
    expect(removedStep?.expectedFeedback).toContain('项目列表中发现');
    expect(removedStep?.note).toContain('fresh member session');
  });

  it('drives the real spec with promoted-member permissions instead of reusing joined-member permissions', () => {
    const specSource = readFileSync('e2e/integration-workspace-project-governance-matrix.spec.ts', 'utf8');

    expect(specSource).toContain('promotedMemberPermissions');
    expect(specSource).toContain('expectedPermissions: runtime.promotedMemberPermissions');
    expect(specSource).toContain('expectedPermissions: runtime.joinedMemberPermissions');
  });
});
