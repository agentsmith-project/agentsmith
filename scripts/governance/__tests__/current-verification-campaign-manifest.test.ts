import { describe, expect, it } from 'vitest';

import { findCurrentGateDefinitionById } from '../current-gate-manifest';
import {
  CURRENT_VERIFICATION_CAMPAIGN_MANIFEST,
  findCurrentVerificationCampaignById,
} from '../current-verification-campaign-manifest';

describe('current verification campaign manifest', () => {
  it('defines release-full as the release-grade campaign truth', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');

    expect(CURRENT_VERIFICATION_CAMPAIGN_MANIFEST).toContain(releaseFull);
    expect(releaseFull?.runRootPattern).toBe('artifacts/release-runs/<campaign-run-id>');
    expect(releaseFull?.steps.map((step) => step.id)).toEqual([
      'gate-fast',
      'gate-default',
      'lane-visual',
      'gate-release',
      'lane-demo-rehearsal',
      'lane-cluster-rehearsal',
      'gate-release-full',
    ]);
  });

  it('binds every campaign step to a current gate or lane definition', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    for (const step of releaseFull.steps) {
      const gate = findCurrentGateDefinitionById(step.gateId);

      expect(gate).toBeDefined();
      expect(step.npmScript).toBe(gate?.npmScript);
      expect(step.command).toBe(`npm run ${gate?.npmScript}`);
      expect(step.resultRequired).toBe(true);
    }
  });

  it('separates executable evidence owners from the aggregate-only terminal verdict', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    const terminalStep = releaseFull.steps.at(-1);
    const executableSteps = releaseFull.steps.slice(0, -1);

    expect(terminalStep).toMatchObject({
      id: 'gate-release-full',
      workflowRole: 'terminal_verdict',
      executionMode: 'aggregate_only',
      evidenceRequired: true,
    });

    for (const step of executableSteps) {
      expect(step.executionMode).toBe('execute');
      expect(step.id).not.toBe('gate-release-full');
    }
  });

  it('requires native results and concrete evidence checks for release evidence owner steps', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    const evidenceOwners = releaseFull.steps.filter((step) => step.workflowRole === 'evidence_owner');
    expect(evidenceOwners.map((step) => step.id)).toEqual([
      'lane-visual',
      'gate-release',
      'lane-demo-rehearsal',
      'lane-cluster-rehearsal',
    ]);

    for (const step of evidenceOwners) {
      expect(step.nativeResult).toBeDefined();
      expect(step.nativeResult?.path).toContain('<campaign-root>');
      expect(step.nativeResult?.npmScript).toMatch(/^lane:/);
      expect(step.evidenceChecks.length).toBeGreaterThan(0);
    }

    expect(releaseFull.steps.find((step) => step.id === 'lane-visual')?.evidenceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'visual_baseline_reviews' }),
      ]),
    );
    expect(releaseFull.steps.find((step) => step.id === 'gate-release')?.evidenceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '<campaign-root>/gate-release/backend-real-visual/review.md', kind: 'file' }),
        expect.objectContaining({
          id: 'backend_real_ux_trace_reviews',
          path: '<campaign-root>/gate-release/backend-real-visual/ux-traces',
          kind: 'recursive_file',
          semantic: 'ux_trace_bundle',
        }),
      ]),
    );
  });

  it('derives campaign evidence owner paths from the current gate campaign topology', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    for (const step of releaseFull.steps.filter((candidate) => candidate.workflowRole === 'evidence_owner')) {
      const gate = findCurrentGateDefinitionById(step.gateId);

      expect(gate?.campaignEvidenceArtifacts).toEqual(step.evidenceChecks.map((check) => check.path));
      expect(gate?.campaignEvidenceArtifacts.length).toBeGreaterThan(0);
      expect(gate?.campaignEvidenceArtifacts.every((path) => path.includes('<campaign-root>') || path.startsWith('e2e/'))).toBe(true);
    }

    const terminalStep = releaseFull.steps.find((step) => step.id === 'gate-release-full');
    const terminalGate = findCurrentGateDefinitionById('gate-release-full');

    expect(terminalStep?.evidenceHints).toEqual(terminalGate?.campaignEvidenceArtifacts);
    expect(terminalGate?.standaloneEvidenceArtifacts).toEqual([]);
    expect(terminalGate?.campaignEvidenceArtifacts.every((path) => path.startsWith('<campaign-root>'))).toBe(true);
  });
});
