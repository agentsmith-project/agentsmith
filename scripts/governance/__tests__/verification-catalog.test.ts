import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCommittedStoryDefinitionsSync } from '../../story-catalog-support';
import {
  listCurrentVerificationCampaigns,
  type CurrentVerificationCampaignDefinition,
} from '../current-verification-campaign-manifest';
import {
  buildVerificationCatalog,
  GENERATED_STORY_SPEC_PATH,
  VERIFICATION_CATALOG_SCHEMA,
  writeVerificationCatalog,
} from '../verification-catalog';

describe('verification catalog', () => {
  it('declares the read-only catalog schema and authoritative provenance', () => {
    const catalog = buildVerificationCatalog({
      generatedAt: '2026-04-25T12:00:00.000Z',
    });

    expect(catalog.schema).toBe(VERIFICATION_CATALOG_SCHEMA);
    expect(catalog.provenance).toEqual({
      generated_at: '2026-04-25T12:00:00.000Z',
      projection_kind: 'read_only',
      artifact_directory_inspection: false,
      verdict_state: 'none',
      evidence_claims_created: false,
    });
    expect(catalog.source_truth.canonical_stories).toMatchObject({
      authority: 'authoritative',
      source_mode: 'default_loader',
      loader: 'loadCommittedStoryDefinitionsSync',
      path_glob: 'e2e/stories/**/*.story.md',
    });
    expect(catalog.source_truth.current_gate_manifest.gate_ids).toContain('lane-visual');
    expect(catalog.source_truth.current_verification_campaign_manifest.campaign_ids).toEqual(['release-full']);
    expect(catalog.source_truth.visual_catalog).toMatchObject({
      authority: 'derived_projection',
      source_mode: 'default_builder',
      builder: 'listVisualBaselineCatalogEntries',
      source_module: 'e2e/visual-baseline-support.ts',
    });
    expect(catalog.source_truth.gate_result_schema.writer_gate_ids).toContain('lane-backend-real-core');
  });

  it('marks custom story and visual inputs as non-default input overrides', () => {
    const [story] = loadCommittedStoryDefinitionsSync();
    const catalog = buildVerificationCatalog({
      stories: [story],
      visualCatalogEntries: [],
    });

    expect(catalog.source_truth.canonical_stories).toMatchObject({
      authority: 'input_override_non_authoritative',
      source_mode: 'input_override',
      loader: null,
      path_glob: null,
      story_count: 1,
    });
    expect(catalog.source_truth.visual_catalog).toMatchObject({
      authority: 'input_override_non_authoritative',
      source_mode: 'input_override',
      builder: null,
      source_spec: null,
      source_module: null,
      entry_count: 0,
    });
    expect(catalog.source_truth.generated_story_specs.source_builder).toContain('input story override');
  });

  it('marks generated story specs as derived cache and never uses them as story truth', () => {
    const catalog = buildVerificationCatalog();

    expect(catalog.source_truth.generated_story_specs).toMatchObject({
      authority: 'derived_cache',
      authoritative: false,
      path: GENERATED_STORY_SPEC_PATH,
      used_as_story_truth: false,
    });
    expect(catalog.generated_story_specs).toMatchObject({
      authority: 'derived_cache_only',
      authoritative: false,
      used_as_story_truth: false,
      path: GENERATED_STORY_SPEC_PATH,
    });
    expect(catalog.story_source_file_map[GENERATED_STORY_SPEC_PATH]).toBeUndefined();
    expect(catalog.stories.every((story) => story.sourceFile !== GENERATED_STORY_SPEC_PATH)).toBe(true);
    expect(catalog.generated_story_specs.story_ids.length).toBe(catalog.stories.length);
  });

  it('maps ChatMainPane visual code refs to V2 visual story surfaces', () => {
    const catalog = buildVerificationCatalog();
    const mappings = catalog.visual_code_ref_map['src/components/chat/ChatMainPane.tsx'] ?? [];

    expect(mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storyId: 'mock-lane-chat-operate-and-recover',
        level: 'V2',
        evidenceOwner: 'npm run verify:visual',
      }),
    ]));
    expect(mappings.some((mapping) => mapping.surface.startsWith('visual:'))).toBe(true);
    expect(catalog.story_by_id['mock-lane-chat-operate-and-recover']?.visualScenarioIds.length)
      .toBeGreaterThan(0);
  });

  it('projects backend-real stories with V3 owner and artifact template without inspecting artifacts', () => {
    const catalog = buildVerificationCatalog();
    const story = catalog.story_by_id['notebook-first-success'];
    const v3 = catalog.evidence.levels.V3;

    expect(story).toMatchObject({
      lane: 'backend-real',
      sourceFile: 'e2e/stories/backend-real/notebook-first-success.story.md',
      requiredLevels: ['V0', 'V1', 'V3'],
    });
    expect(v3).toMatchObject({
      owner: 'npm run verify:real',
      gateId: 'lane-backend-real-core',
      artifactPathTemplate: 'artifacts/backend-real/runs/<run-id>/ux-traces',
      verdictState: 'none',
    });
  });

  it('projects V4 release-ready ownership without a release verdict', () => {
    const catalog = buildVerificationCatalog();
    const v4 = catalog.evidence.levels.V4;

    expect(v4).toMatchObject({
      owner: 'npm run release:ready',
      gateId: 'gate-release-full',
      artifactPathTemplate: 'artifacts/release-runs/<campaign-run-id>/gate-release-full/result.json',
      verdictState: 'none',
    });
    expect(v4.additionalArtifactPathTemplates).toContain('artifacts/release-runs/<campaign-run-id>');
    expect(catalog.provenance.verdict_state).toBe('none');
  });

  it('does not fabricate V4 release evidence templates when campaign truth is missing', () => {
    const withoutCampaign = buildVerificationCatalog({
      verificationCampaigns: [],
    });
    const releaseFull = listCurrentVerificationCampaigns().find((campaign) => campaign.id === 'release-full');
    if (!releaseFull) {
      throw new Error('release-full campaign fixture is required');
    }
    const withoutTerminalHint: CurrentVerificationCampaignDefinition = {
      ...releaseFull,
      steps: releaseFull.steps.map((step) => (
        step.id === 'gate-release-full'
          ? { ...step, evidenceHints: [] }
          : step
      )),
    };
    const withoutHint = buildVerificationCatalog({
      verificationCampaigns: [withoutTerminalHint],
    });

    expect(withoutCampaign.source_truth.current_verification_campaign_manifest).toMatchObject({
      authority: 'input_override_non_authoritative',
      source_mode: 'input_override',
      module: null,
      campaign_ids: [],
    });
    expect(withoutCampaign.evidence.levels.V4).toMatchObject({
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [],
      artifactPathTemplateReason: 'No current release-full campaign gate-release-full result artifact template is registered.',
    });
    expect(withoutHint.evidence.levels.V4).toMatchObject({
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [releaseFull.runRootPattern],
      artifactPathTemplateReason: 'No current release-full campaign gate-release-full result artifact template is registered.',
    });
  });

  it('keeps evidence owner commands aligned with package entrypoints', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    const catalog = buildVerificationCatalog();
    const ownerCommands = [
      catalog.evidence.levels.V0.owner,
      catalog.evidence.levels.V1.owner,
      catalog.evidence.levels.V2.owner,
      catalog.evidence.levels.V3.owner,
      catalog.evidence.levels.V3.releaseRealDiagnostic.owner,
      catalog.evidence.levels.V4.owner,
    ];

    for (const ownerCommand of ownerCommands) {
      expect(ownerCommand.startsWith('npm run ')).toBe(true);
      expect(packageJson.scripts[ownerCommand.replace(/^npm run /, '')]).toBeTruthy();
    }
  });

  it('writes the read-only catalog projection under the report root', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verification-catalog-'));
    try {
      const catalog = buildVerificationCatalog({
        generatedAt: '2026-04-25T12:00:00.000Z',
      });
      const result = writeVerificationCatalog(catalog, root);
      const persisted = JSON.parse(readFileSync(result.jsonPath, 'utf8')) as typeof catalog;

      expect(result).toMatchObject({
        reportRoot: resolve(root),
        jsonPath: join(resolve(root), 'verification-catalog.json'),
      });
      expect(persisted.schema).toBe(VERIFICATION_CATALOG_SCHEMA);
      expect(persisted.provenance).toEqual({
        generated_at: '2026-04-25T12:00:00.000Z',
        projection_kind: 'read_only',
        artifact_directory_inspection: false,
        verdict_state: 'none',
        evidence_claims_created: false,
      });
      expect(readFileSync(result.jsonPath, 'utf8').endsWith('\n')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
