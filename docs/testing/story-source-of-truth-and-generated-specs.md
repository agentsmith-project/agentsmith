# Story Source Of Truth And Generated Specs

This repo uses `e2e/stories/backend-real/*.story.md` as the canonical source for executable visual / trace user stories.

Rules:

- A committed story must live under `e2e/stories/backend-real/` and be named `<story-id>.story.md`.
- The `e2e/stories/` root does not keep committed story files; sibling directories under it are the only canonical story homes.
- `e2e/story-loader.ts` recursively discovers committed story files, reads them, and resolves story ids to files.
- `e2e/story-contract.ts` owns the story schema, validation, and fingerprint helpers.
- `e2e/story-generated-spec.ts` derives `e2e/generated/story-specs.generated.json` from the loaded story files.
- `e2e/story-trace-binding.ts` uses the same loaded story definitions to bind trace events.
- Integration specs may reference the canonical story contract, but they must not hardcode release story manifests or duplicate trace metadata maps.
- If a story changes, update the story markdown first, then regenerate the derived JSON and trace bindings.

Format:

- Canonical story files are Markdown files with a required JSON frontmatter block.
- The frontmatter contains the fully structured story payload used by loader, generated specs, and trace bindings.
- There is no parallel section-based story format in the repo.

Verification:

- `scripts/story-contract.test.ts`
- `scripts/story-generated-spec.test.ts`
- `scripts/story-trace-binding.test.ts`
- `scripts/release-user-story-contract.test.ts`
