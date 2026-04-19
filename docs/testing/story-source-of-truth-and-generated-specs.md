# Story Source Of Truth And Generated Specs

This repo uses canonical lane directories under `e2e/stories/` as the source of truth for executable visual / trace user stories:

- `e2e/stories/backend-real/*.story.md`
- `e2e/stories/mock-lane/*.story.md`

Rules:

- A committed story must live under one of the canonical lane directories and be named `<story-id>.story.md`.
- The `e2e/stories/` root does not keep committed story files; sibling lane directories under it are the only canonical story homes.
- `e2e/story-loader.ts` only discovers committed stories from canonical lane directories, reads them, and resolves story ids to files.
- `e2e/story-contract.ts` owns the story schema, validation, and fingerprint helpers.
- `e2e/story-generated-spec.ts` derives `e2e/generated/story-specs.generated.json` from the loaded story files.
- `e2e/story-trace-binding.ts` uses the same loaded story definitions to bind trace events.
- `scripts/story-product-surface-coverage.test.ts` is the major product surface coverage guard that keeps the committed story catalog anchored to the coverage map.
- Integration specs may reference the canonical story contract, but they must not hardcode release story manifests or duplicate trace metadata maps.
- If a story changes, update the story markdown first, then regenerate the derived JSON and trace bindings.
- Use `npm run story-generated-spec:sync` to rewrite `e2e/generated/story-specs.generated.json` from the canonical story files.
- Use `npm run story-generated-spec:check` to fail on freshness drift; `npm run contracts:check` runs this check automatically.
- `e2e/generated/story-specs.generated.json` is a checked-in cache, but it must remain a byte-for-byte projection of the canonical story files.

Format:

- Canonical story files are Markdown files with a required JSON frontmatter block.
- The frontmatter contains the fully structured story payload used by loader, generated specs, and trace bindings.
- There is no parallel section-based story format in the repo.
- Story family metadata now lives in the canonical story payload:
  - `family`
  - `personas`
  - `kind`
  - `gatePolicy`
  - `externalDependencies`
- Visual catalog scene metadata also lives in the canonical story payload at `runtimeData.visualReview.scenes`.

Verification:

- `scripts/story-contract.test.ts`
- `scripts/story-generated-spec.test.ts`
- `scripts/story-trace-binding.test.ts`
- `scripts/story-product-surface-coverage.test.ts`
- `scripts/release-user-story-contract.test.ts`

## Story Edit Loop

When a user story changes, edit the story markdown first. Do not start from generated JSON, trace metadata, or Playwright assertions.

Use this order:

1. Update the canonical `*.story.md` file under `e2e/stories/backend-real/` or `e2e/stories/mock-lane/`.
2. Run `npm run story-generated-spec:sync` to regenerate the derived generated-spec cache, then refresh any other derived story artifacts that changed with the same markdown edit.
3. Re-run the smallest affected story contract test.
4. Re-run the owning evidence producer, such as the affected mock lane, backend-real story lane, or visual lane.
5. Run `npm run story-generated-spec:check` or `npm run contracts:check` before handing off or merging.
6. Only after the owner is green, rerun the gate that needs the story evidence.

Do not accept a generated artifact diff if the canonical story markdown does not explain the product behavior and user expectation.
