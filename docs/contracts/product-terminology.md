# Product Terminology Contract

This document defines canonical product-facing terminology.

## Canonical Terms

1. `System Admin`
- User-facing name for the system-level administration surface.
- Scope: workspace lifecycle, workspace data config, workspace IdP config, workspace admin assignment.

2. `Workspace Entry`
- User-facing concept for entering a workspace before business login.
- Scope: public workspace picker and direct workspace URL entry.

3. `Notebook`
- User-facing module name for task-based agent workflow.
- Canonical route: `.../notebook`
- Scope: task-based agent workflow with three logical zones:
  - left: inputs/context
  - center: user-agent conversation
  - right: generated artifacts

4. `Files`
- User-facing module name for project file management (object browser).
- Canonical route: `.../files`
- Scope: libraries, folders, upload/download, rename/move, delete, preview, share-link.

5. `Inputs` (or `Context Inputs`)
- Conversation-time data fed to agent execution.
- Inputs can come from Files, local upload, URL fetch, or direct paste.

6. `Artifacts`
- Agent-generated outputs (text/image/structured results) produced in Notebook runs.

## Rules

1. Product-facing UI and route naming must use the canonical terms above.
2. System admin entry and workspace business entry must remain distinct concepts.
3. Do not reintroduce removed names in routing, docs, or UI copy.
4. Inputs/Artifacts terminology is scoped to Notebook execution interactions.
