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

describe('project governance access model story', () => {
  it('describes the access model from invite acceptance through effective-access changes', () => {
    const story = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/membership-change-and-effective-access.story.md');
    const runtime = story.runtimeData?.membershipChange as
      | {
          joinedMemberPermissions?: string[];
          promotedMemberPermissions?: string[];
        }
      | undefined;

    expect(story.title).toBe('Project governance access model');
    expect(story.family).toBe('project-governance-access-model');
    expect(story.goal).toContain('邀请');
    expect(story.goal).toContain('effective access');
    expect(story.narrative).toContain('接受邀请');
    expect(story.narrative).toContain('effective access drawer');

    expect(runtime?.joinedMemberPermissions).toEqual(PROJECT_MEMBER_TEMPLATE_PERMISSIONS);
    expect(runtime?.promotedMemberPermissions).toEqual(PROJECT_ADMIN_TEMPLATE_PERMISSIONS);

    const inviteStep = story.steps.find((step) => step.stepId === 'issue-project-invite');
    const acceptStep = story.steps.find((step) => step.stepId === 'accept-project-invite');
    const firstAccessStep = story.steps.find((step) => step.stepId === 'open-member-effective-access');
    const promoteStep = story.steps.find((step) => step.stepId === 'promote-member-admin');
    const reopenStep = story.steps.find((step) => step.stepId === 'reopen-member-effective-access-after-promotion');
    const demoteStep = story.steps.find((step) => step.stepId === 'demote-member-back');
    const removedStep = story.steps.find((step) => step.stepId === 'verify-removed-access');

    expect(inviteStep?.target).toBe('members__invite-btn');
    expect(inviteStep?.expectedFeedback).toContain('邀请链接');
    expect(acceptStep?.target).toBe('member-detail__effective-access-summary');
    expect(acceptStep?.expectedFeedback).toContain('Project Members');
    expect(firstAccessStep?.target).toBe('member-detail__effective-access-summary');
    expect(firstAccessStep?.expectedFeedback).toContain('Project Members');
    expect(promoteStep?.expectedFeedback).toContain('Project Admins');
    expect(reopenStep?.expectedFeedback).toContain('Project Admins');
    expect(demoteStep?.expectedFeedback).toContain('Project Members');
    expect(removedStep?.expectedFeedback).toContain('Project unavailable');
    expect(removedStep?.note).toContain('fresh member session');
  });

  it('drives the real spec through invite acceptance and effective-access truth', () => {
    const specSource = readFileSync('e2e/integration-workspace-project-governance-matrix.spec.ts', 'utf8');

    expect(specSource).toContain('issue-project-invite');
    expect(specSource).toContain('accept-project-invite');
    expect(specSource).toContain('open-member-effective-access');
    expect(specSource).toContain('members__invite-btn');
    expect(specSource).toContain('member-detail__effective-access-summary');
    expect(specSource).toContain('createInviteViaUi');
    expect(specSource).toContain('expectedPermissions: runtime.promotedMemberPermissions');
    expect(specSource).toContain('expectedPermissions: runtime.joinedMemberPermissions');
  });
});
