# Global UI Consistency Design

Date: 2026-02-06

## Context

The frontend has undergone substantial refactoring. Visual and layout consistency is drifting across pages due to ad-hoc spacing, local wrappers, and mixed usage of shared layout primitives. This plan standardizes global layout, typography, and panel chrome while limiting per-page edits to targeted fixes.

## Goals

- Enforce consistent page structure, spacing, and typography across all pages.
- Centralize page chrome (header, toolbar, body) in shared layout primitives.
- Standardize empty/loading/error states with predictable alignment.
- Reduce layout drift caused by local page wrappers.

## Non-Goals

- Full redesign or new UI style system.
- Backward compatibility for legacy layouts.
- Adding new visual themes beyond the current design system.

## Approach Summary

1. Make shared layout primitives (`PageLayout`, `PageState`, table/panel wrappers) the single source of truth.
2. Apply targeted page fixes only where pages deviate from those primitives.
3. Verify consistency through visual and UX guardrail tests.

## Architecture

The shared layout primitives define page chrome:

- **Page header:** title + action slot, fixed spacing and typography.
- **Toolbar row:** optional filters/search, consistent vertical rhythm.
- **Body:** flex container with `min-h-0`, consistent `gap` scale.
- **State wrapper:** unified behavior for loading/empty/error/success.

Pages should not re-implement margins, backgrounds, or header layouts. The app shell (topbar/sidebar) provides the outer boundary; internal pages must align to the shared primitives.

## Component Standards

- **PageLayout/PageState:** enforce full-height and stable flex behavior.
- **Panels/Cards:** single “panel” chrome (bg, border, radius, padding).
- **Tables:** shared DataTable wrapper for headers, empty states, and spacing.
- **Dialogs:** shared dialog variants for spacing and button alignment.
- **Typography:** H1/H2/Body mapping aligned with the design system.

Targeted per-page edits replace local wrappers with shared components and remove conflicting spacing/background classes.

## Data Flow & Interaction

- Data fetching remains in pages; visual states render exclusively through `PageState`.
- Primary actions live in the page header action slot.
- Filters/search live in the toolbar row.
- Section headers follow consistent spacing and action placement.

## Error & Edge Handling

- Page-level errors use a single error template (title, hint, action).
- Section-level errors render contained error panels.
- Empty states are centered and full-height for consistent layout.
- Tables use their internal empty states, matching page styling.
- Loading states use skeletons/placeholders to avoid layout shift.

## Testing & Verification

- **Playwright visual tests:** compare full-page screenshots to ensure consistent chrome and spacing.
- **UX guardrails tests:** verify headings, spacing, and empty/error state rendering.
- **E2E flows:** re-validate key pages after layout changes (chat, settings, members, projects).

## Rollout Plan

1. Update shared layout primitives.
2. Apply targeted per-page fixes.
3. Re-capture visual snapshots.
4. Update UX/UI docs if new standards or exceptions are introduced.

## Risks

- Over-constraining page layouts that require custom behavior.
- Visual regressions in pages with bespoke layouts.

## Success Criteria

- Page chrome is consistent across all major pages.
- Empty/loading/error states appear in the same position and style.
- Visual regression tests show no layout drift.
