# Notebook Frontend Module Map

This document defines the current module boundary for the Notebook list page and its immediate growth constraints.

Terminology note:
- Product name: `Notebook`
- Canonical route: `/notebook`

## Scope

- Route: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/page.tsx`
- List UI: `src/components/notebook/TaskList.tsx`
- Detail route is intentionally out of this document.

## Current Structure

1. `notebook/page.tsx`
- Route param validation and permission gate (`project:notebook:access`).
- Uses shared project layout mode (`useProjectLayoutMode`) to control page width:
  - `standard` -> `contentWidth="wide"`
  - `ultrawide` -> `contentWidth="full"`
- No page-local layout toggle. Toggle is owned by Topbar (`topbar__layout-toggle`).

2. `TaskList.tsx`
- Owns task list data loading (`useTasks`) and list-level interactions.
- Uses compact module toolbar pattern (action row only, no duplicate page title row).
- Primary action: `notebook__create-task-btn`.
- Empty/loading/list rendering are contained in this component.

3. Notebook detail (`components/notebook/TaskPage.tsx`)
- Three-pane layout contract:
  - left: Inputs panel
  - center: Conversation panel
  - right: Artifacts panel
- Inputs panel supports three add channels in current prototype:
  - Files library picker (canonical)
  - Local upload (uploads to Files, then attaches)
  - URL input (stored as URL note file, then attaches)

## UX Contract

- Keep project-level header density consistent with Chat/Files:
  - No duplicate module title row inside page content.
  - Keep toolbars compact and action-first.
- Preserve existing test ids for regression stability:
  - `notebook__task-list`
  - `notebook__create-task-btn`
  - `notebook__task-card`

## Growth Guardrails

- If list toolbar grows beyond one row, split into a dedicated toolbar component before adding more logic.
- Do not add per-page width toggles; keep layout mode global at project shell level.
- Keep route-level permission and parameter validation in `notebook/page.tsx`; avoid leaking this logic into leaf UI components.
