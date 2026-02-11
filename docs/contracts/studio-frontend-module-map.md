# AI Studio Frontend Module Map

This document defines the current module boundary for the AI Studio list page and its immediate growth constraints.

## Scope

- Route: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/studio/page.tsx`
- List UI: `src/components/studio/RecipeList.tsx`
- Detail route is intentionally out of this document.

## Current Structure

1. `studio/page.tsx`
- Route param validation and permission gate (`project:studio:access`).
- Uses shared project layout mode (`useProjectLayoutMode`) to control page width:
  - `standard` -> `contentWidth="wide"`
  - `ultrawide` -> `contentWidth="full"`
- No page-local layout toggle. Toggle is owned by Topbar (`topbar__layout-toggle`).

2. `RecipeList.tsx`
- Owns recipe list data loading (`useRecipes`) and list-level interactions.
- Uses compact module toolbar pattern (action row only, no duplicate page title row).
- Primary action: `studio__create-recipe-btn`.
- Empty/loading/list rendering are contained in this component.

## UX Contract

- Keep project-level header density consistent with Chat/Sources:
  - No duplicate module title row inside page content.
  - Keep toolbars compact and action-first.
- Preserve existing test ids for regression stability:
  - `studio__recipe-list`
  - `studio__create-recipe-btn`
  - `studio__recipe-card`

## Growth Guardrails

- If list toolbar grows beyond one row, split into a dedicated toolbar component before adding more logic.
- Do not add per-page width toggles; keep layout mode global at project shell level.
- Keep route-level permission and parameter validation in `studio/page.tsx`; avoid leaking this logic into leaf UI components.
