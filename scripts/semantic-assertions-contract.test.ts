import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertProminentActionCountFits,
  assertProminentActionsUseDesignSystemMetadata,
  parseSemanticTargetReference,
  resolveProminentActionScopeTestIds,
  assertSingularSemanticTargetMatchCount,
  assertViewerLocalDateTimeMetadata,
  summarizeProminentActionCandidates,
  assertViewportBoxFits,
  type ProminentActionCandidate,
} from '../e2e/utils/semantic-assertions';

function parseStoryFrontMatter(filePath: string) {
  const source = readFileSync(filePath, 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) {
    throw new Error(`story front matter is missing in ${filePath}`);
  }
  return JSON.parse(match[1]) as {
    runtimeData?: {
      visualReview?: {
        scenes?: Array<{
          sceneId: string;
          semanticAssertions?: {
            requiredViewerLocalDateTimeTestIds?: string[];
          };
        }>;
      };
    };
  };
}

describe('visual semantic viewport assertions', () => {
  const viewport = { width: 320, height: 240 };
  const prominentAction: ProminentActionCandidate = {
    label: 'Custom CTA',
    isInteractive: true,
    isMarkedPrimary: false,
    tagName: 'button',
    role: 'button',
    inputType: null,
    box: {
      x: 16,
      y: 24,
      width: 120,
      height: 36,
    },
    viewport,
    backgroundColor: 'rgb(17, 24, 39)',
    color: 'rgb(255, 255, 255)',
    rootBackgroundColor: 'rgb(255, 255, 255)',
    opacity: 1,
    pointerEvents: 'auto',
    display: 'inline-flex',
    visibility: 'visible',
  };

  it('accepts a non-zero element box that fully fits inside the viewport', () => {
    expect(() => assertViewportBoxFits('primary-action', {
      x: 16,
      y: 24,
      width: 120,
      height: 32,
    }, viewport)).not.toThrow();
  });

  it('rejects an offscreen element instead of treating DOM visibility as enough', () => {
    expect(() => assertViewportBoxFits('primary-action', {
      x: 16,
      y: 260,
      width: 120,
      height: 32,
    }, viewport)).toThrow(/fit inside the viewport height/);
  });

  it('rejects a partially clipped element at the right edge of the viewport', () => {
    expect(() => assertViewportBoxFits('primary-action', {
      x: 280,
      y: 24,
      width: 64,
      height: 32,
    }, viewport)).toThrow(/fit inside the viewport width/);
  });

  it('rejects scenes that render more prominent actions than the story-owned limit', () => {
    expect(() => assertProminentActionCountFits({
      scenarioId: 'system-workspaces',
      prominentActionCount: 2,
      maxProminentActions: 1,
    })).toThrow(/allows at most 1 prominent action/);
  });

  it('accepts scenes that stay within the prominent action limit', () => {
    expect(() => assertProminentActionCountFits({
      scenarioId: 'workspace-connections-feishu-connected',
      prominentActionCount: 0,
      maxProminentActions: 0,
    })).not.toThrow();
  });

  it('rejects unmarked visual-primary interactive controls instead of trusting metadata only', () => {
    expect(summarizeProminentActionCandidates([prominentAction])).toMatchObject({
      prominentActionCount: 1,
      unmarkedProminentActions: [expect.objectContaining({ label: 'Custom CTA' })],
    });

    expect(() => assertProminentActionsUseDesignSystemMetadata({
      scenarioId: 'workspace-connections-feishu-connected',
      candidates: [prominentAction],
    })).toThrow(/without design-system prominence metadata/);
  });

  it('does not treat non-interactive badges as prominent actions even when their fill is strong', () => {
    expect(summarizeProminentActionCandidates([{
      ...prominentAction,
      label: 'Connected badge',
      isInteractive: false,
    }])).toMatchObject({
      prominentActionCount: 0,
      unmarkedProminentActions: [],
    });
  });

  it('does not treat checkbox, radio, or switch selection controls as CTA prominence violations', () => {
    const selectionControls: ProminentActionCandidate[] = [
      {
        ...prominentAction,
        label: '',
        tagName: 'button',
        role: 'checkbox',
      },
      {
        ...prominentAction,
        label: '',
        tagName: 'button',
        role: 'switch',
      },
      {
        ...prominentAction,
        label: '',
        tagName: 'input',
        role: null,
        inputType: 'radio',
      },
    ];

    expect(summarizeProminentActionCandidates(selectionControls)).toMatchObject({
      prominentActionCount: 0,
      unmarkedProminentActions: [],
    });
  });

  it('requires viewer-local datetime metadata to carry a machine-readable dateTime value', () => {
    expect(() => assertViewerLocalDateTimeMetadata({
      testId: 'workspace-connections__last-refresh-value',
      dateTime: null,
      policy: 'viewer_local',
    })).toThrow(/machine-readable dateTime metadata/);
  });

  it('requires viewer-local datetime metadata to declare the viewer_local policy', () => {
    expect(() => assertViewerLocalDateTimeMetadata({
      testId: 'workspace-connections__last-refresh-value',
      dateTime: '2026-03-19T00:00:00.000Z',
      policy: 'utc',
    })).toThrow(/viewer_local policy/);
  });

  it('accepts viewer-local datetime metadata when both dateTime and viewer_local policy are present', () => {
    expect(() => assertViewerLocalDateTimeMetadata({
      testId: 'workspace-connections__last-refresh-value',
      dateTime: '2026-03-19T00:00:00.000Z',
      policy: 'viewer_local',
    })).not.toThrow();
  });

  it('rejects duplicate raw viewer-local datetime targets instead of treating count > 0 as good enough', () => {
    expect(() => assertSingularSemanticTargetMatchCount({
      count: 2,
      kind: 'viewer-local datetime target',
      reference: 'notebook__task-last-activity',
    })).toThrow(/requires unique viewer-local datetime target: notebook__task-last-activity/);
  });

  it('accepts a singular scoped viewer-local datetime target match', () => {
    expect(() => assertSingularSemanticTargetMatchCount({
      count: 1,
      kind: 'viewer-local datetime target',
      reference: 'notebook__task-card--task_001::notebook__task-last-activity',
    })).not.toThrow();
  });

  it('requires the notebook lifecycle list story to use unique surface-scoped datetime targets', () => {
    const story = parseStoryFrontMatter('e2e/stories/mock-lane/mock-lane-notebook-task-lifecycle.story.md');
    const notebookLifecycleListScene = story.runtimeData?.visualReview?.scenes?.find(
      (scene) => scene.sceneId === 'notebook-task-lifecycle-list',
    );

    expect(notebookLifecycleListScene?.semanticAssertions?.requiredViewerLocalDateTimeTestIds ?? []).toEqual([
      'notebook__task-card--task_001::notebook__task-last-activity',
      'notebook__task-card--task_001::notebook__task-created-at',
    ]);
  });

  it('parses a surface-scoped semantic target reference into unique surface and target ids', () => {
    expect(parseSemanticTargetReference('system-workspaces__editor::system-workspaces__detail-header-initialized-at')).toEqual({
      raw: 'system-workspaces__editor::system-workspaces__detail-header-initialized-at',
      surfaceTestId: 'system-workspaces__editor',
      targetTestId: 'system-workspaces__detail-header-initialized-at',
    });
    expect(parseSemanticTargetReference('system-workspaces__save')).toEqual({
      raw: 'system-workspaces__save',
      surfaceTestId: null,
      targetTestId: 'system-workspaces__save',
    });
  });

  it('rejects malformed surface-scoped semantic target references', () => {
    expect(() => parseSemanticTargetReference('system-workspaces__editor::')).toThrow(/surface-scoped semantic target/i);
    expect(() => parseSemanticTargetReference('::system-workspaces__save')).toThrow(/surface-scoped semantic target/i);
    expect(() => parseSemanticTargetReference('page-layout__header::system-workspaces__new-workspace::extra')).toThrow(
      /surface-scoped semantic target/i,
    );
  });

  it('prefers explicit prominent action scopes over primary-target-derived fallback', () => {
    expect(resolveProminentActionScopeTestIds({
      prominentActionScopeTestIds: [
        'page-layout__header',
        'system-workspaces__list',
        'system-workspaces__editor',
      ],
      primaryActionTestIds: [
        'system-workspaces__editor::system-workspaces__save',
      ],
    })).toEqual([
      'page-layout__header',
      'system-workspaces__list',
      'system-workspaces__editor',
    ]);
  });

  it('derives unique prominent action scopes from scoped primary targets when explicit scopes are absent', () => {
    expect(resolveProminentActionScopeTestIds({
      primaryActionTestIds: [
        'page-layout__header::system-workspaces__new-workspace',
        'system-workspaces__editor::system-workspaces__save',
        'system-workspaces__editor::system-workspaces__delete',
      ],
    })).toEqual([
      'page-layout__header',
      'system-workspaces__editor',
    ]);
  });

  it('falls back to page-wide prominent action scanning when primary targets are not all surface-scoped', () => {
    expect(resolveProminentActionScopeTestIds({
      primaryActionTestIds: [
        'page-layout__header::system-workspaces__new-workspace',
        'system-workspaces__delete-confirm',
      ],
    })).toBeNull();
  });
});

describe('visual semantic singular target auto-wait assertions', () => {
  afterEach(() => {
    vi.doUnmock('@playwright/test');
    vi.resetModules();
  });

  it('waits for a viewport target to converge to a singular match before enforcing viewport semantics', async () => {
    class SequencedLocator {
      private readonly counts: number[];

      constructor(counts: number[]) {
        this.counts = [...counts];
      }

      async count() {
        if (this.counts.length > 1) {
          return this.counts.shift()!;
        }
        return this.counts[0] ?? 0;
      }

      async boundingBox() {
        return {
          x: 16,
          y: 24,
          width: 120,
          height: 32,
        };
      }
    }

    vi.resetModules();
    vi.doMock('@playwright/test', () => ({
      expect(actual: { count?: () => Promise<number> }, message?: string) {
        return {
          async toHaveCount(expected: number) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
              if (typeof actual.count === 'function' && await actual.count() === expected) {
                return;
              }
            }

            const finalCount = typeof actual.count === 'function' ? await actual.count() : Number.NaN;
            throw new Error(message ?? `expected locator count ${expected}, received ${finalCount}`);
          },
          async toBeVisible() {
            return;
          },
        };
      },
    }));

    const { expectVisualSemanticAssertions } = await import('../e2e/utils/semantic-assertions');
    const viewportTarget = new SequencedLocator([0, 1]);
    const page = {
      locator(selector: string) {
        if (selector === 'body') {
          return new SequencedLocator([1]);
        }
        throw new Error(`unexpected selector: ${selector}`);
      },
      getByTestId(testId: string) {
        if (testId === 'workspace__status') {
          return viewportTarget;
        }
        throw new Error(`unexpected test id: ${testId}`);
      },
      viewportSize() {
        return { width: 320, height: 240 };
      },
    };

    await expect(expectVisualSemanticAssertions(page as never, {
      forbiddenVisibleText: [],
      forbiddenVisibleTextPatterns: [],
      requiredViewportTestIds: ['workspace__status'],
      requiredViewerLocalDateTimeTestIds: [],
      primaryActionTestIds: [],
      prominentActionScopeTestIds: [],
      maxProminentActions: null,
    })).resolves.toBeUndefined();
  });
});
