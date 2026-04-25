import path from 'node:path';

import type { StoryDefinition } from '../../e2e/story-contract';
import {
  listVisualBaselineCatalogEntries,
  type VisualBaselineCatalogEntry,
} from '../../e2e/visual-baseline-support';
import { loadCommittedStoryDefinitionsSync } from '../story-catalog-support';
import {
  findCurrentGateDefinitionById,
  listCurrentGateDefinitions,
} from './current-gate-manifest';
import {
  findCurrentGateResultWriter,
  resolveCurrentGateResultPath,
  CURRENT_GATE_RESULT_ARTIFACT_NAME,
  CURRENT_GATE_RESULT_SCHEMA_VERSION,
  CURRENT_GATE_RESULT_STATUSES,
  CURRENT_GATE_RESULT_WRITERS,
} from './current-gate-result-schema';
import {
  listCurrentVerificationCampaigns,
  type CurrentVerificationCampaignDefinition,
} from './current-verification-campaign-manifest';

export const VERIFICATION_CATALOG_SCHEMA = 'agentsmith_verification_catalog/v1' as const;
export const GENERATED_STORY_SPEC_PATH = 'e2e/generated/story-specs.generated.json' as const;
export const VERIFICATION_LEVEL_ORDER = ['V0', 'V1', 'V2', 'V3', 'V4'] as const;

export type VerificationCatalogLevel = (typeof VERIFICATION_LEVEL_ORDER)[number];

export interface VerificationCatalogStory {
  storyId: string;
  title: string;
  personas: readonly string[];
  family: string;
  lane: StoryDefinition['lane'];
  sourceFile: string;
  filePath: string;
  gatePolicy: StoryDefinition['gatePolicy'];
  requiredLevels: readonly VerificationCatalogLevel[];
  visualScenarioIds: readonly string[];
  sourceTruth: {
    kind: 'canonical_story_markdown';
    path: string;
  };
}

export interface VerificationCatalogVisualEntry {
  id: string;
  scenarioId: string;
  storyId: string;
  storySceneId: string;
  storySourceFile: string;
  route: string;
  group: VisualBaselineCatalogEntry['group'];
  codeRefs: readonly string[];
  storyEvidenceKind: VisualBaselineCatalogEntry['storyEvidenceKind'];
  storyEvidenceOwner: VisualBaselineCatalogEntry['storyEvidenceOwner'];
  sourceSpec: VisualBaselineCatalogEntry['sourceSpec'];
}

export interface VerificationCatalogVisualCodeRefMapping {
  codeRef: string;
  storyId: string;
  scenarioId: string;
  storySceneId: string;
  storySourceFile: string;
  surface: string;
  level: 'V2';
  evidenceOwner: 'npm run verify:visual';
}

export interface VerificationEvidenceProjection {
  level: VerificationCatalogLevel;
  owner: string;
  gateId: string | null;
  source: 'current_gate_manifest' | 'current_gate_result_schema' | 'current_verification_campaign_manifest';
  state: 'not_inspected_projection';
  verdictState: 'none';
  artifactPathTemplate: string | null;
  additionalArtifactPathTemplates: readonly string[];
  artifactPathTemplateReason: string | null;
}

export interface VerificationCatalogV3EvidenceProjection extends VerificationEvidenceProjection {
  level: 'V3';
  releaseRealDiagnostic: VerificationEvidenceProjection & {
    level: 'V3';
  };
}

export interface VerificationCatalogEvidenceProjection {
  levels: {
    V0: VerificationEvidenceProjection & { level: 'V0' };
    V1: VerificationEvidenceProjection & { level: 'V1' };
    V2: VerificationEvidenceProjection & { level: 'V2' };
    V3: VerificationCatalogV3EvidenceProjection;
    V4: VerificationEvidenceProjection & { level: 'V4' };
  };
}

export interface VerificationCatalog {
  schema: typeof VERIFICATION_CATALOG_SCHEMA;
  provenance: {
    generated_at: string;
    projection_kind: 'read_only';
    artifact_directory_inspection: false;
    verdict_state: 'none';
    evidence_claims_created: false;
  };
  source_truth: {
    canonical_stories: {
      authority: 'authoritative' | 'input_override_non_authoritative';
      source_mode: 'default_loader' | 'input_override';
      loader: 'loadCommittedStoryDefinitionsSync' | null;
      path_glob: 'e2e/stories/**/*.story.md' | null;
      story_count: number;
    };
    current_gate_manifest: {
      authority: 'authoritative';
      module: 'scripts/governance/current-gate-manifest.ts';
      gate_ids: readonly string[];
    };
    current_verification_campaign_manifest: {
      authority: 'authoritative' | 'input_override_non_authoritative';
      source_mode: 'default_manifest' | 'input_override';
      module: 'scripts/governance/current-verification-campaign-manifest.ts' | null;
      campaign_ids: readonly string[];
    };
    visual_catalog: {
      authority: 'derived_projection' | 'input_override_non_authoritative';
      source_mode: 'default_builder' | 'input_override';
      builder: 'listVisualBaselineCatalogEntries' | null;
      source_spec: 'e2e/visual.spec.ts' | null;
      source_module: 'e2e/visual-baseline-support.ts' | null;
      entry_count: number;
      scenario_count: number;
    };
    gate_result_schema: {
      authority: 'authoritative';
      module: 'scripts/governance/current-gate-result-schema.ts';
      schema_version: typeof CURRENT_GATE_RESULT_SCHEMA_VERSION;
      artifact_name: typeof CURRENT_GATE_RESULT_ARTIFACT_NAME;
      statuses: typeof CURRENT_GATE_RESULT_STATUSES;
      writer_gate_ids: readonly string[];
    };
    generated_story_specs: {
      authority: 'derived_cache';
      authoritative: false;
      path: typeof GENERATED_STORY_SPEC_PATH;
      source_builder: string;
      used_as_story_truth: false;
      spec_count: number;
    };
  };
  stories: readonly VerificationCatalogStory[];
  story_by_id: Record<string, VerificationCatalogStory>;
  story_source_file_map: Record<string, string>;
  visual_catalog: {
    entries: readonly VerificationCatalogVisualEntry[];
  };
  visual_code_ref_map: Record<string, readonly VerificationCatalogVisualCodeRefMapping[]>;
  evidence: VerificationCatalogEvidenceProjection;
  generated_story_specs: {
    authority: 'derived_cache_only';
    authoritative: false;
    used_as_story_truth: false;
    path: typeof GENERATED_STORY_SPEC_PATH;
    story_ids: readonly string[];
  };
}

export interface BuildVerificationCatalogInput {
  generatedAt?: string;
  stories?: readonly StoryDefinition[];
  visualCatalogEntries?: readonly VisualBaselineCatalogEntry[];
  verificationCampaigns?: readonly CurrentVerificationCampaignDefinition[];
}

type EvidenceTemplateResolution = {
  artifactPathTemplate: string | null;
  additionalArtifactPathTemplates: readonly string[];
  artifactPathTemplateReason: string | null;
};

export function normalizeVerificationCatalogRepoPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) {
    return normalized;
  }
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
  const relative = path.relative(process.cwd(), absolute).replace(/\\/g, '/');
  return relative.startsWith('../') ? normalized.replace(/^\.\//, '') : relative;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function orderedLevels(values: Iterable<VerificationCatalogLevel>): VerificationCatalogLevel[] {
  const selected = new Set(values);
  return VERIFICATION_LEVEL_ORDER.filter((level) => selected.has(level));
}

function levelsForStory(story: StoryDefinition): readonly VerificationCatalogLevel[] {
  const levels = new Set<VerificationCatalogLevel>(['V0', 'V1']);
  if (story.lane === 'mock-lane' || story.gatePolicy.requiredEvidence.includes('visual')) {
    levels.add('V2');
  }
  if (story.lane === 'backend-real') {
    levels.add('V3');
  }
  return orderedLevels(levels);
}

function currentGateResultTemplate(gateId: string): EvidenceTemplateResolution {
  if (!findCurrentGateResultWriter(gateId)) {
    return {
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [],
      artifactPathTemplateReason: `No registered current gate result writer for ${gateId}; verify report records the owner but cannot name a stable canonical artifact template.`,
    };
  }

  return {
    artifactPathTemplate: resolveCurrentGateResultPath(`artifacts/gate-results/${gateId}/<run-id>`),
    additionalArtifactPathTemplates: [],
    artifactPathTemplateReason: null,
  };
}

function firstCurrentGateStoryArtifact(gateId: string, match: (artifactPath: string) => boolean): string | null {
  return findCurrentGateDefinitionById(gateId)?.storyEvidenceArtifacts.find(match) ?? null;
}

function firstCurrentGateStandaloneArtifact(gateId: string, match: (artifactPath: string) => boolean): string | null {
  return findCurrentGateDefinitionById(gateId)?.standaloneEvidenceArtifacts.find(match) ?? null;
}

function releaseCampaignEvidenceTemplate(
  campaigns: readonly CurrentVerificationCampaignDefinition[],
): EvidenceTemplateResolution {
  const campaign = campaigns.find((entry) => entry.id === 'release-full');
  if (!campaign) {
    return {
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [],
      artifactPathTemplateReason: 'No current release-full campaign gate-release-full result artifact template is registered.',
    };
  }

  const runRootPattern = campaign.runRootPattern;
  const terminalStep = campaign?.steps.find((step) => step.id === 'gate-release-full');
  const resultHint = terminalStep?.evidenceHints.find((hint) => hint.endsWith('/gate-release-full/result.json'));
  if (!resultHint) {
    return {
      artifactPathTemplate: null,
      additionalArtifactPathTemplates: [runRootPattern],
      artifactPathTemplateReason: 'No current release-full campaign gate-release-full result artifact template is registered.',
    };
  }

  return {
    artifactPathTemplate: resultHint.replaceAll('<campaign-root>', runRootPattern),
    additionalArtifactPathTemplates: [runRootPattern],
    artifactPathTemplateReason: null,
  };
}

function evidenceProjection(args: {
  level: VerificationCatalogLevel;
  owner: string;
  gateId: string | null;
  source: VerificationEvidenceProjection['source'];
  template: EvidenceTemplateResolution;
}): VerificationEvidenceProjection {
  return {
    level: args.level,
    owner: args.owner,
    gateId: args.gateId,
    source: args.source,
    state: 'not_inspected_projection',
    verdictState: 'none',
    artifactPathTemplate: args.template.artifactPathTemplate,
    additionalArtifactPathTemplates: args.template.additionalArtifactPathTemplates,
    artifactPathTemplateReason: args.template.artifactPathTemplateReason,
  };
}

function buildEvidenceProjection(
  verificationCampaigns: readonly CurrentVerificationCampaignDefinition[],
): VerificationCatalogEvidenceProjection {
  const v0 = evidenceProjection({
    level: 'V0',
    owner: 'npm run verify:quick',
    gateId: 'gate-fast',
    source: 'current_gate_result_schema',
    template: currentGateResultTemplate('gate-fast'),
  }) as VerificationCatalogEvidenceProjection['levels']['V0'];
  const v1 = evidenceProjection({
    level: 'V1',
    owner: 'npm run verify:default',
    gateId: 'gate-default',
    source: 'current_gate_result_schema',
    template: currentGateResultTemplate('gate-default'),
  }) as VerificationCatalogEvidenceProjection['levels']['V1'];
  const v2Template = firstCurrentGateStandaloneArtifact(
    'lane-visual',
    (artifactPath) => artifactPath.endsWith('/run-manifest.json'),
  );
  const v2 = evidenceProjection({
    level: 'V2',
    owner: 'npm run verify:visual',
    gateId: 'lane-visual',
    source: 'current_gate_manifest',
    template: {
      artifactPathTemplate: v2Template,
      additionalArtifactPathTemplates: [],
      artifactPathTemplateReason: v2Template
        ? null
        : 'No current lane-visual standalone run-manifest artifact template is registered.',
    },
  }) as VerificationCatalogEvidenceProjection['levels']['V2'];
  const v3Template = firstCurrentGateStoryArtifact(
    'lane-backend-real-core',
    (artifactPath) => artifactPath.includes('/ux-traces'),
  );
  const v3ReleaseDiagnosticTemplate = firstCurrentGateStandaloneArtifact(
    'gate-release',
    (artifactPath) => artifactPath.includes('/ux-traces'),
  );
  const v3 = {
    ...evidenceProjection({
      level: 'V3',
      owner: 'npm run verify:real',
      gateId: 'lane-backend-real-core',
      source: 'current_gate_manifest',
      template: {
        artifactPathTemplate: v3Template,
        additionalArtifactPathTemplates: [],
        artifactPathTemplateReason: v3Template
          ? null
          : 'No current lane-backend-real-core UX trace artifact template is registered.',
      },
    }),
    releaseRealDiagnostic: evidenceProjection({
      level: 'V3',
      owner: 'npm run verify:release-real',
      gateId: 'gate-release',
      source: 'current_gate_manifest',
      template: {
        artifactPathTemplate: v3ReleaseDiagnosticTemplate,
        additionalArtifactPathTemplates: [],
        artifactPathTemplateReason: v3ReleaseDiagnosticTemplate
          ? null
          : 'No current gate-release UX trace artifact template is registered.',
      },
    }) as VerificationEvidenceProjection & { level: 'V3' },
  } as VerificationCatalogV3EvidenceProjection;
  const v4 = evidenceProjection({
    level: 'V4',
    owner: 'npm run release:ready',
    gateId: 'gate-release-full',
    source: 'current_verification_campaign_manifest',
    template: releaseCampaignEvidenceTemplate(verificationCampaigns),
  }) as VerificationCatalogEvidenceProjection['levels']['V4'];

  return {
    levels: {
      V0: v0,
      V1: v1,
      V2: v2,
      V3: v3,
      V4: v4,
    },
  };
}

function buildVisualProjection(entries: readonly VisualBaselineCatalogEntry[]): {
  entries: VerificationCatalogVisualEntry[];
  codeRefMap: Record<string, readonly VerificationCatalogVisualCodeRefMapping[]>;
  scenarioIdsByStoryId: Map<string, string[]>;
} {
  const codeRefMap = new Map<string, VerificationCatalogVisualCodeRefMapping[]>();
  const scenarioIdsByStoryId = new Map<string, string[]>();

  const projectedEntries = entries.map((entry) => {
    const storySourceFile = normalizeVerificationCatalogRepoPath(entry.storySourceFile);
    const codeRefs = entry.codeRefs.map(normalizeVerificationCatalogRepoPath);
    const storyScenarioIds = scenarioIdsByStoryId.get(entry.storyId) ?? [];
    storyScenarioIds.push(entry.scenarioId);
    scenarioIdsByStoryId.set(entry.storyId, storyScenarioIds);

    for (const codeRef of codeRefs) {
      const mappings = codeRefMap.get(codeRef) ?? [];
      mappings.push({
        codeRef,
        storyId: entry.storyId,
        scenarioId: entry.scenarioId,
        storySceneId: entry.storySceneId,
        storySourceFile,
        surface: `visual:${entry.scenarioId}`,
        level: 'V2',
        evidenceOwner: 'npm run verify:visual',
      });
      codeRefMap.set(codeRef, mappings);
    }

    return {
      id: entry.id,
      scenarioId: entry.scenarioId,
      storyId: entry.storyId,
      storySceneId: entry.storySceneId,
      storySourceFile,
      route: entry.route,
      group: entry.group,
      codeRefs,
      storyEvidenceKind: entry.storyEvidenceKind,
      storyEvidenceOwner: entry.storyEvidenceOwner,
      sourceSpec: entry.sourceSpec,
    };
  });

  return {
    entries: projectedEntries,
    codeRefMap: Object.fromEntries(
      [...codeRefMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([codeRef, mappings]) => [
          codeRef,
          [...mappings].sort((left, right) => (
            `${left.scenarioId}:${left.storyId}`.localeCompare(`${right.scenarioId}:${right.storyId}`)
          )),
        ]),
    ),
    scenarioIdsByStoryId,
  };
}

function buildStoryProjection(
  stories: readonly StoryDefinition[],
  scenarioIdsByStoryId: ReadonlyMap<string, readonly string[]>,
): {
  stories: VerificationCatalogStory[];
  storyById: Record<string, VerificationCatalogStory>;
  storySourceFileMap: Record<string, string>;
} {
  const projectedStories = stories.map((story) => {
    const sourceFile = normalizeVerificationCatalogRepoPath(story.sourceFile ?? story.filePath);
    const filePath = normalizeVerificationCatalogRepoPath(story.filePath);
    return {
      storyId: story.storyId,
      title: story.title,
      personas: [...story.personas],
      family: story.family,
      lane: story.lane,
      sourceFile,
      filePath,
      gatePolicy: {
        tier: story.gatePolicy.tier,
        requiredEvidence: [...story.gatePolicy.requiredEvidence],
      },
      requiredLevels: levelsForStory(story),
      visualScenarioIds: uniqueSorted(scenarioIdsByStoryId.get(story.storyId) ?? []),
      sourceTruth: {
        kind: 'canonical_story_markdown',
        path: sourceFile,
      },
    };
  }).sort((left, right) => left.storyId.localeCompare(right.storyId));

  return {
    stories: projectedStories,
    storyById: Object.fromEntries(projectedStories.map((story) => [story.storyId, story])),
    storySourceFileMap: Object.fromEntries(projectedStories.map((story) => [story.sourceFile, story.storyId])),
  };
}

export function buildVerificationCatalog(input: BuildVerificationCatalogInput = {}): VerificationCatalog {
  const stories = input.stories ?? loadCommittedStoryDefinitionsSync();
  const visualCatalogEntries = input.visualCatalogEntries ?? listVisualBaselineCatalogEntries();
  const verificationCampaigns = input.verificationCampaigns ?? listCurrentVerificationCampaigns();
  const generatedStorySpecStoryIds = stories.map((story) => story.storyId);
  const visualProjection = buildVisualProjection(visualCatalogEntries);
  const storyProjection = buildStoryProjection(stories, visualProjection.scenarioIdsByStoryId);
  const gateIds = listCurrentGateDefinitions().map((definition) => definition.id);
  const campaignIds = verificationCampaigns.map((campaign) => campaign.id);
  const visualScenarioCount = new Set(visualCatalogEntries.map((entry) => entry.scenarioId)).size;
  const storiesUseInputOverride = Boolean(input.stories);
  const visualCatalogUsesInputOverride = Boolean(input.visualCatalogEntries);
  const verificationCampaignsUseInputOverride = Boolean(input.verificationCampaigns);

  return {
    schema: VERIFICATION_CATALOG_SCHEMA,
    provenance: {
      generated_at: input.generatedAt ?? new Date().toISOString(),
      projection_kind: 'read_only',
      artifact_directory_inspection: false,
      verdict_state: 'none',
      evidence_claims_created: false,
    },
    source_truth: {
      canonical_stories: {
        authority: storiesUseInputOverride ? 'input_override_non_authoritative' : 'authoritative',
        source_mode: storiesUseInputOverride ? 'input_override' : 'default_loader',
        loader: storiesUseInputOverride ? null : 'loadCommittedStoryDefinitionsSync',
        path_glob: storiesUseInputOverride ? null : 'e2e/stories/**/*.story.md',
        story_count: storyProjection.stories.length,
      },
      current_gate_manifest: {
        authority: 'authoritative',
        module: 'scripts/governance/current-gate-manifest.ts',
        gate_ids: gateIds,
      },
      current_verification_campaign_manifest: {
        authority: verificationCampaignsUseInputOverride ? 'input_override_non_authoritative' : 'authoritative',
        source_mode: verificationCampaignsUseInputOverride ? 'input_override' : 'default_manifest',
        module: verificationCampaignsUseInputOverride
          ? null
          : 'scripts/governance/current-verification-campaign-manifest.ts',
        campaign_ids: campaignIds,
      },
      visual_catalog: {
        authority: visualCatalogUsesInputOverride ? 'input_override_non_authoritative' : 'derived_projection',
        source_mode: visualCatalogUsesInputOverride ? 'input_override' : 'default_builder',
        builder: visualCatalogUsesInputOverride ? null : 'listVisualBaselineCatalogEntries',
        source_spec: visualCatalogUsesInputOverride ? null : 'e2e/visual.spec.ts',
        source_module: visualCatalogUsesInputOverride ? null : 'e2e/visual-baseline-support.ts',
        entry_count: visualCatalogEntries.length,
        scenario_count: visualScenarioCount,
      },
      gate_result_schema: {
        authority: 'authoritative',
        module: 'scripts/governance/current-gate-result-schema.ts',
        schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
        artifact_name: CURRENT_GATE_RESULT_ARTIFACT_NAME,
        statuses: CURRENT_GATE_RESULT_STATUSES,
        writer_gate_ids: CURRENT_GATE_RESULT_WRITERS.map((writer) => writer.gate_id),
      },
      generated_story_specs: {
        authority: 'derived_cache',
        authoritative: false,
        path: GENERATED_STORY_SPEC_PATH,
        source_builder: storiesUseInputOverride
          ? 'input story override metadata; generated specs are not loaded as story truth'
          : 'canonical story id projection; generated specs are not loaded as story truth',
        used_as_story_truth: false,
        spec_count: generatedStorySpecStoryIds.length,
      },
    },
    stories: storyProjection.stories,
    story_by_id: storyProjection.storyById,
    story_source_file_map: storyProjection.storySourceFileMap,
    visual_catalog: {
      entries: visualProjection.entries,
    },
    visual_code_ref_map: visualProjection.codeRefMap,
    evidence: buildEvidenceProjection(verificationCampaigns),
    generated_story_specs: {
      authority: 'derived_cache_only',
      authoritative: false,
      used_as_story_truth: false,
      path: GENERATED_STORY_SPEC_PATH,
      story_ids: generatedStorySpecStoryIds,
    },
  };
}

export function loadDefaultVerificationCatalog(): VerificationCatalog {
  return buildVerificationCatalog();
}

export function evidenceProjectionForLevel(args: {
  catalog: VerificationCatalog;
  level: VerificationCatalogLevel;
  releaseRealDiagnostic?: boolean;
}): VerificationEvidenceProjection {
  if (args.level === 'V3' && args.releaseRealDiagnostic) {
    return args.catalog.evidence.levels.V3.releaseRealDiagnostic;
  }
  return args.catalog.evidence.levels[args.level];
}
