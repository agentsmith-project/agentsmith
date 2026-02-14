# Product Terminology Contract

This document defines canonical product-facing terminology.

## Canonical Terms

1. `Notebook`
- User-facing module name for task-based agent workflow.
- Canonical route: `.../notebook`
- Scope: task-based agent workflow with three logical zones:
  - left: inputs/context
  - center: user-agent conversation
  - right: generated artifacts

2. `Files`
- User-facing module name for project file management (object browser).
- Canonical route: `.../files`
- Scope: libraries, folders, upload/download, rename/move, delete, preview, share-link.

3. `Inputs` (or `Context Inputs`)
- Conversation-time data fed to agent execution.
- Inputs can come from Files, local upload, URL fetch, or direct paste.

4. `Artifacts`
- Agent-generated outputs (text/image/structured results) produced in Notebook runs.

## Rules

1. Product-facing UI and route naming must use only `Notebook` and `Files`.
2. Do not introduce legacy aliases in routing, docs, or UI copy.
3. Inputs/Artifacts terminology is scoped to Notebook runtime interactions.
