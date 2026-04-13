import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

const STORY_FILE = path.resolve(process.cwd(), 'e2e/stories/backend-real/project-owner-daily-governance-review.story.md');

describe('project owner daily governance review story', () => {
  it('defines a backend-real journey around project health review and follow-up decisions', () => {
    const story = loadStoryDefinitionSync(STORY_FILE);

    expect(story.lane).toBe('backend-real');
    expect(story.gatePolicy).toEqual({
      tier: 'default',
      requiredEvidence: ['trace'],
    });
    expect(story.goal).toContain('看懂项目现在运行如何');
    expect(story.goal).toContain('要不要处理');
    expect(story.goal).not.toContain('表格');
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'open-usage-review',
      'inspect-runtime-usage',
      'inspect-audit-detail',
      'configure-alert-follow-up',
    ]);

    const runtime = (story.runtimeData as Record<string, unknown> | undefined)?.governanceReview as
      | Record<string, unknown>
      | undefined;
    expect(runtime?.projectNamePrefix).toBeTruthy();
    expect(runtime?.credentialNamePrefix).toBeTruthy();
    expect(runtime?.endpointNamePrefix).toBeTruthy();
    expect(runtime?.alertRuleNamePrefix).toBeTruthy();
    expect(story.steps[3]?.expectedFeedback).toContain('alerts follow-up surface');
    expect(story.steps[3]?.expectedFeedback).toContain('当前真实后端');
    expect(story.steps[3]?.expectedFeedback).not.toContain('已保存的结果');
    expect(story.steps[3]?.expectedFeedback).not.toContain('可提交状态');
  });

  it('binds the focused real governance spec to the owner review story instead of the self-scope spec', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-project-owner-governance-review.spec.ts'),
      'utf-8',
    );

    expect(source).toContain("loadStoryDefinitionSync(");
    expect(source).toContain("project-owner-daily-governance-review.story.md");
    expect(source).toContain('buildTraceStoryBinding');
    expect(source).toContain('createUxTraceBundleWriter');
    expect(source).toContain("stepId: 'open-usage-review'");
    expect(source).toContain("stepId: 'inspect-runtime-usage'");
    expect(source).toContain("stepId: 'inspect-audit-detail'");
    expect(source).toContain("stepId: 'configure-alert-follow-up'");
    expect(source).toContain('waitForEndpointTrafficReady');
    expect(source).toContain('governance_review_endpoint_not_ready');
    expect(source).toContain("body.message === 'fetch failed'");
    expect(source).toContain('openAuditDetailFromFirstRow');
    expect(source).toContain('audit__row-actions--');
    expect(source).toContain('audit__view-details--${rowId}');
    expect(source).toContain('alert-rules-list__empty');
    expect(source).toContain('alert-center__create-button');
    expect(source).not.toContain('alert-rule-form-dialog__submit-btn');
    expect(source).not.toContain('createdRule.id');
    expect(source).not.toContain("locator('[data-testid^=\"audit__view-details--\"]').first()");
    expect(source).not.toContain('persistedRule');
    expect(source).not.toContain('可提交状态');
    expect(source).not.toContain('usage stays self-scoped');
    expect(source).not.toContain('different members can open their own usage page');
  });
});
