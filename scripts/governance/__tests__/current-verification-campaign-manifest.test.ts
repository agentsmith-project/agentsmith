import { describe, expect, it } from 'vitest';

import { findCurrentGateDefinitionById } from '../current-gate-manifest';
import {
  CURRENT_VERIFICATION_CAMPAIGN_MANIFEST,
  findCurrentVerificationCampaignById,
} from '../current-verification-campaign-manifest';

describe('current verification campaign manifest', () => {
  it('defines release-full as the AgentSmith product-side readiness campaign truth', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');

    expect(CURRENT_VERIFICATION_CAMPAIGN_MANIFEST).toContain(releaseFull);
    expect(releaseFull?.description).toContain('AgentSmith product-side readiness');
    expect(releaseFull?.description).not.toMatch(/terminal aggregate verdict|deployment|package|operator/i);
    expect(releaseFull?.runRootPattern).toBe('artifacts/release-runs/<campaign-run-id>');
    expect(releaseFull?.steps.map((step) => step.id)).toEqual([
      'gate-fast',
      'gate-default',
      'lane-visual',
      'gate-release',
      'gate-release-full',
    ]);
  });

  it('keeps unified deploy lanes out of the release-full campaign', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    const stepIds = releaseFull.steps.map((step) => step.id);
    expect(stepIds.filter((id) => id.startsWith('lane-unified-deploy-'))).toEqual([]);
    expect(releaseFull.steps.find((step) => step.id === 'gate-release-full')?.dependsOn).not.toEqual(
      expect.arrayContaining([
        'lane-unified-deploy-substrate',
        'lane-unified-deploy-local-kind-images',
        'lane-unified-deploy-local-kind',
        'lane-unified-deploy-product-flows',
      ]),
    );
  });

  it('keeps release-kit online adoption handoff out of release-full steps', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    const stepSurface = releaseFull.steps.flatMap((step) => [
      step.id,
      step.gateId,
      step.npmScript,
      step.command,
      ...step.dependsOn,
    ]);

    expect(stepSurface.join('\n')).not.toMatch(/release-kit|online-adoption|handoff/iu);
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

  it('defines bounded step timeouts before the product readiness job fallback', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    expect(Object.fromEntries(releaseFull.steps.map((step) => [step.id, step.timeoutMs]))).toEqual({
      'gate-fast': 20 * 60_000,
      'gate-default': 45 * 60_000,
      'lane-visual': 45 * 60_000,
      'gate-release': 90 * 60_000,
      'gate-release-full': 10 * 60_000,
    });
    expect(releaseFull.steps.every((step) => Number.isSafeInteger(step.timeoutMs) && step.timeoutMs > 0)).toBe(true);
    expect(releaseFull.steps.reduce((total, step) => total + step.timeoutMs, 0)).toBeLessThan(240 * 60_000);
  });

  it('classifies backend-real release waits as runtime pending readiness with increasing observation intervals', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    const gateRelease = releaseFull.steps.find((step) => step.id === 'gate-release');
    const policy = gateRelease?.observationPolicy;

    expect(policy).toMatchObject({
      theme: 'runtime_pending_readiness',
      backoff: 'increasing_after_consecutive_non_terminal',
    });
    expect(policy?.intervalMs).toEqual([60_000, 90_000, 120_000, 180_000, 300_000]);
    expect(policy?.evidenceFocus).toEqual(
      expect.arrayContaining([
        'Files restore continuation focused backend-real gate',
        'AGENT_SANDBOX_UNAVAILABLE API/pod-manager/ASBCP summaries',
        'runtime flake versus stability blocker classification',
      ]),
    );
    expect(Object.keys(policy?.stateConvergence ?? {}).sort()).toEqual([
      'afscp_workspace_binding',
      'agent_task_sandbox',
      'files',
      'read_export',
    ]);
    for (const surface of ['files', 'agent_task_sandbox', 'afscp_workspace_binding', 'read_export'] as const) {
      expect(Object.keys(policy?.stateConvergence?.[surface] ?? {}).sort()).toEqual([
        'not_found',
        'offline',
        'pending',
        'releasing',
      ]);
    }
    expect(policy?.stateConvergence?.agent_task_sandbox.offline).toContain('ASBCP create-or-ensure');
    expect(policy?.stateConvergence?.afscp_workspace_binding.releasing).toContain('terminal released/revoked/expired/deleted');
    expect(policy?.stateConvergence?.read_export.pending).toContain('typed pending');
    expect(gateRelease?.evidenceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'files_restore_continuation_runtime_readiness_details',
          path: '<campaign-root>/gate-release/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-details.json',
          kind: 'file',
          expectedSchemaVersion: 'agentsmith.runtime-readiness-details/v1',
          expectedTheme: 'runtime_pending_readiness',
        }),
      ]),
    );
  });

  it('separates executable evidence owners from the aggregate-only readiness check', () => {
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

  it('binds visual product readiness evidence at the aggregate check instead of gate-release', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    const visualStep = releaseFull.steps.find((step) => step.id === 'lane-visual');
    const gateReleaseStep = releaseFull.steps.find((step) => step.id === 'gate-release');
    const terminalStep = releaseFull.steps.find((step) => step.id === 'gate-release-full');

    expect(gateReleaseStep?.dependsOn).toEqual(['gate-default']);
    expect(gateReleaseStep?.dependsOn).not.toContain('lane-visual');
    expect(terminalStep?.dependsOn).toEqual(
      expect.arrayContaining(['lane-visual', 'gate-release']),
    );
    expect(visualStep).toMatchObject({
      workflowRole: 'evidence_owner',
      executionMode: 'execute',
      resultRequired: true,
      evidenceRequired: true,
    });
    expect(findCurrentGateDefinitionById('lane-visual')?.requiredFor).toContain('release');
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
    ]);

    for (const step of evidenceOwners) {
      expect(step.nativeResult).toBeDefined();
      expect(step.nativeResult?.path).toContain('<campaign-root>');
      expect(step.nativeResult?.npmScript).toMatch(/^lane:/);
      expect(step.evidenceChecks.length).toBeGreaterThan(0);
    }

    const visualStep = releaseFull.steps.find((step) => step.id === 'lane-visual');
    const visualEvidenceKinds = visualStep?.evidenceChecks.map((check) => (check as { kind: string }).kind);
    expect(visualStep?.evidenceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'visual_baseline_automated_passes' }),
      ]),
    );
    expect(visualEvidenceKinds).toEqual(
      expect.arrayContaining(['visual_run_manifest', 'visual_baseline_automated_passes']),
    );
    expect(releaseFull.steps.find((step) => step.id === 'gate-release')?.evidenceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '<campaign-root>/gate-release/backend-real-visual/review.md', kind: 'file' }),
        expect.objectContaining({
          id: 'backend_real_ux_trace_index',
          path: '<campaign-root>/gate-release/backend-real-visual/ux-traces/ux-trace-index.json',
          kind: 'file',
        }),
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

      expect(step.evidenceHints).toEqual(gate?.campaignEvidenceArtifacts);
      expect(step.evidenceChecks.map((check) => check.path)).toEqual(
        expect.arrayContaining(gate?.campaignEvidenceArtifacts ?? []),
      );
      expect(gate?.campaignEvidenceArtifacts.length).toBeGreaterThan(0);
      expect(gate?.campaignEvidenceArtifacts.every((path) => path.includes('<campaign-root>') || path.startsWith('e2e/'))).toBe(true);
    }

    const terminalStep = releaseFull.steps.find((step) => step.id === 'gate-release-full');
    const terminalGate = findCurrentGateDefinitionById('gate-release-full');

    expect(terminalStep?.evidenceHints).toEqual(terminalGate?.campaignEvidenceArtifacts);
    expect(terminalGate?.standaloneEvidenceArtifacts).toEqual([]);
    expect(terminalGate?.campaignEvidenceArtifacts.every((path) => path.startsWith('<campaign-root>'))).toBe(true);
  });

  it('keeps lane-visual authority hints narrow while runtime checks stay wide', () => {
    const releaseFull = findCurrentVerificationCampaignById('release-full');
    if (!releaseFull) {
      throw new Error('Missing release-full campaign.');
    }

    const visualStep = releaseFull.steps.find((step) => step.id === 'lane-visual');
    const visualGate = findCurrentGateDefinitionById('lane-visual');
    const visualCheckKinds = visualStep?.evidenceChecks.map((check) => (check as { kind: string }).kind) ?? [];

    expect(visualStep?.evidenceHints).toEqual([
      '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json',
    ]);
    expect(visualStep?.evidenceHints).toEqual(visualGate?.campaignEvidenceArtifacts);
    expect(visualStep?.evidenceHints).not.toContain(
      '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<visual-scenario-id>/review.md',
    );
    expect(visualStep?.evidenceChecks.map((check) => check.path)).toEqual(
      expect.arrayContaining([
        '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json',
        '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<visual-scenario-id>/automated-pass.md',
      ]),
    );
    expect(visualCheckKinds).toEqual(
      expect.arrayContaining(['visual_run_manifest', 'visual_baseline_automated_passes']),
    );
  });
});
