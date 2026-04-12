# User Story Contract v1

## Purpose

This contract defines the executable user story source used by trace, visual review, and generated story specs.

The source of truth is:

- `e2e/stories/backend-real/*.story.md`

Derived artifacts are not truth sources:

- `e2e/generated/story-specs.generated.json`
- trace bundles under `artifacts/`
- backend-real visual review records under `artifacts/`

The committed generated cache is still a checked-in artifact, but it must be a byte-for-byte projection of the canonical story markdown files. Tests must fail if the cache drifts from regenerated output.

## Ownership

- `e2e/story-loader.ts`
  - story file discovery
  - markdown/frontmatter parsing
  - file reads
  - duplicate id detection
  - story id to file resolution
- `e2e/story-contract.ts`
  - types
  - validation
  - fingerprint helpers

## File naming

- Committed stories must live under `e2e/stories/backend-real/`
- Filename must match story id exactly: `<story-id>.story.md`

## Supported file formats

Canonical story files are Markdown files with a required JSON object frontmatter block.

Required top-level fields:

- `storyId`
- `title`
- `actor`
- `lane`
- `entryRoute`
- `goal`
- `narrative`
- `scenes`
- `steps`

Optional top-level fields:

- `preconditions`
- `seedData`
- `runtimeData`

The markdown body is optional and ignored by the loader for canonical stories.

## Structured schema

### Story

- `storyId: string`
- `title: string`
- `actor: string`
- `lane: 'mock-lane' | 'backend-real'`
- `entryRoute: string`
- `goal: string`
- `preconditions?: string[]`
- `seedData?: string[]`
- `narrative: string`
- `runtimeData?: StoryRuntimeData`
- `scenes: StorySceneDefinition[]`
- `steps: StoryStepDefinition[]`
- `story.runtimeData?: StoryRuntimeData`

### Scene

- `sceneId: string`
- `route: string`
- `recipeFamily?: string`
- `authLane?: string`
- `stableMarkers: string[]`

### Step

- `stepId: string`
- `sceneId?: string`
- `intent: string`
- `action: string`
- `target?: string`
- `targetMatch?: 'exact' | 'prefix'`
- `expectedFeedback: string`
- `evidence: Array<'trace' | 'visual' | 'doc'>`
- `optional?: boolean`
- `note?: string`
- `step.note?: string`

### Runtime data

- `notebook?: Record<string, StoryRuntimeNotebookFlowDefinition>`
- `visualReview?: { notebookTask: StoryRuntimeVisualReviewNotebookTaskDefinition }`
- `story.runtimeData.notebook?: Record<string, StoryRuntimeNotebookFlowDefinition>`
- `story.runtimeData.visualReview?: { notebookTask: StoryRuntimeVisualReviewNotebookTaskDefinition }`
- `story.runtimeData.visualReview.notebookTask: StoryRuntimeVisualReviewNotebookTaskDefinition`

### Notebook turn

- `prompt: string`
- `expectedToken: string`
- `expectedArtifactPath: string`
- `minAgentMessages?: number`

### Notebook flow

- `turnOne: StoryRuntimeNotebookTurnDefinition`
- `turnTwo: StoryRuntimeNotebookTurnDefinition`

### Visual review notebook task

- `taskTitlePrefix: string`
- `expectedTokenPrefix: string`
- `artifactNamePrefix: string`
- `artifactExtension: string`
- `promptIntro: string`
- `artifactBodyLines: string[]`

## Validation rules

- `entryRoute` and every scene `route` must start with `/`
- every story must define at least one step
- `sceneId` values must be unique within a story
- `stepId` values must be unique within a story
- steps with `visual` evidence must reference an existing `sceneId`
- if `note` is present, it must be non-empty
- committed filename and `storyId` must match exactly
- committed story ids must be unique across the discovered `backend-real` story root

## Fingerprints

The contract exposes stable fingerprints for drift detection:

- source fingerprint
- story fingerprint
- step-map fingerprint

These fingerprints are written into generated specs and trace bundles so evidence can be invalidated when the story contract changes.

Generated specs and trace bundles carry three drift-detection fingerprints:

- `sourceFingerprint` / `story_source_fingerprint`
  - the committed markdown source file content hash
- `storyFingerprint` / `story_fingerprint`
  - the canonical structured story hash
- `stepMapFingerprint` / `step_map_fingerprint`
  - the step ordering and action/target hash
