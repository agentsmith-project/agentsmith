# System Visual State Coverage TODO v1

Last updated: 2026-03-12  
Owner: Frontend

## 1. Purpose

This document tracks the deferred visual work for `system` pages that require seeded state.

Current visual baseline is healthy for:

1. `system login`
2. `system workspaces`
3. `system info`

However, some high-value `system` UI states are not suitable for ad-hoc UI setup inside `visual.spec.ts`.

## 2. Why This Is Deferred

The missing states are not blocked by page implementation. They are blocked by test setup shape.

Example:

1. `system workspaces edit mode` requires at least one persisted workspace
2. the visual lane currently boots with an empty system workspace registry
3. creating a workspace inline inside a visual test makes the screenshot depend on:
   - request timing
   - page transitions
   - shared mock registry mutation
   - multi-step UI interaction

That approach is too fragile for a stable visual baseline.

## 3. Required Structural Fix

Before adding more `system` state screenshots, introduce a structured seeded-state path for visual tests.

Recommended direction:

1. add a dedicated `system workspace registry` seed helper for mock lane
2. support at least two explicit states:
   - `system-empty`
   - `system-with-workspace`
3. allow `visual.spec.ts` to request the desired system state before page navigation

Acceptable implementations:

1. a mock-only registry seed file loaded by the lane bootstrap
2. a dedicated internal test helper endpoint
3. a Playwright fixture that writes the registry before visiting the page

## 4. Deferred Visual States

These are the next `system` visual states to add after the structural fix exists:

1. `system workspaces edit mode`
2. `system workspaces saved notice`
3. `system workspaces action failed state`
4. `system workspaces delete confirmation`
5. `system workspaces with multiple configured workspaces`

## 5. Constraints

1. Do not create state through a long UI interaction chain inside `visual.spec.ts`
2. Do not rely on previous visual tests to leave the registry in the correct state
3. Do not block current MVP delivery on these deferred screenshots
4. Keep `system` visual setup isolated from workspace business entry visual setup

## 6. Current Decision

For the current MVP mainline:

1. keep page-level `system` visual coverage
2. defer seeded `system` state visuals
3. continue mainline work on system/workspace/product flow without waiting for this fixture work
