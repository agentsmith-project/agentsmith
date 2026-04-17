# Mock Lane Visual Story Linkage

## Purpose

This document defines the canonical linkage between mock-lane visual scenes, story family files, and the visual catalog used by `e2e/visual.spec.ts`.

## Canonical source

- Committed mock-lane visual stories live under `e2e/stories/mock-lane/*.story.md`.
- `e2e/story-loader.ts` loads the canonical story payloads.
- `visual-baseline-support.ts` derives the visual catalog from the loaded story definitions.
- `visual.spec.ts` only consumes the derived helpers; it does not own a separate scenario seed list.

## Story family shape

- Each mock-lane story file owns a family of related scenes.
- The story-scene truth lives in the top-level `scenes` array.
- Visual catalog metadata lives under the canonical story contract at `runtimeData.visualReview.scenes`.
- Each visual catalog scene must reference a story scene via `sceneId`.
- Scene-level semantic acceptance rules live under `runtimeData.visualReview.scenes[].semanticAssertions`.

## Semantic linkage

- `semanticAssertions` is part of the canonical story-owned visual scene payload.
- Semantic target families currently used by the visual lane are `requiredViewportTestIds`, `requiredViewerLocalDateTimeTestIds`, `primaryActionTestIds`, and `prominentActionScopeTestIds`.
- `requiredViewportTestIds`, `requiredViewerLocalDateTimeTestIds`, and `primaryActionTestIds` may point at a raw page-unique `target`, or at a surface-scoped `surface::target`.
- When a story uses `surface::target`, the `surface` must be a unique surface container for that scene before the target assertion runs.
- `prominentActionScopeTestIds` is different: it names the unique surface containers that bound prominent-action counting, so scope and target stay separate.
- This keeps repeated page-local test ids reviewable without inventing a separate visual scenario catalog.

## Required linkage fields

- `storySourceFile`
- `storySceneId`
- `scenarioId`
- `group`
- `codeRefs`

## Drift guard

- The visual catalog must stay aligned with the committed mock-lane story family files.
- If a catalog entry no longer maps back to `e2e/stories/mock-lane/*.story.md`, the linkage tests must fail.
