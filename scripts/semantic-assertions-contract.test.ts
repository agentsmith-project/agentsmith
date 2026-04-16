import { describe, expect, it } from 'vitest';

import {
  assertProminentActionCountFits,
  assertProminentActionsUseDesignSystemMetadata,
  summarizeProminentActionCandidates,
  assertViewportBoxFits,
  type ProminentActionCandidate,
} from '../e2e/utils/semantic-assertions';

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
});
