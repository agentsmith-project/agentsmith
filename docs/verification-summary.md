# E2E Test Verification Summary
> Historical snapshot (2026-02-06).  
> Terminology has been aligned to current naming (`AI Studio` / `studio` route).
**Project:** mbos-frontend-v1
**Date:** 2026-02-06
**Task:** Comprehensive E2E Testing Overhaul

## Executive Summary

All E2E tests pass across three Playwright projects (smoke, chromium, visual).

### Overall Status: PASS

- **Smoke Tests:** 26/26 passing
- **Chromium E2E Tests:** 146/146 passing
- **Visual Regression Tests:** 29/29 passing
- **Total:** 201 tests passing

---

## 1. Test Projects

### Smoke Tests (26 tests)
Covers all routes (public, workspace, project pages) in both `en-US` and `zh-CN` locales.
Validates page load, app shell rendering, and absence of critical console errors.

### Chromium E2E Tests (146 tests)
Full functional testing across all pages and features:

| Test File | Tests | Description |
|-----------|-------|-------------|
| `login.spec.ts` | 7 | Login page display, workspace selection, quick login flow, full journey |
| `projects.spec.ts` | 6 | Projects list, search, create/delete dialog, pin/unpin, navigation |
| `overview.spec.ts` | 4 | KPI cards, time range selector, quick access, activity timeline |
| `chat.spec.ts` | 4 | Three-pane layout, thread selection, composer, send message |
| `workbench.spec.ts` | 8 | AI Studio task list, create task, task detail, conversation input, artifacts (legacy filename) |
| `agents.spec.ts` | 8 | Table rendering, create dialog, toggle, validation |
| `endpoints.spec.ts` | 7 | Table rendering, create dialog, validation |
| `credentials.spec.ts` | 9 | Table rendering, create/rotate/delete dialogs |
| `members.spec.ts` | 7 | Table rendering, invite dialog, member drawer, validation |
| `sources.spec.ts` | 5 | Table rendering, upload dialog, file selection |
| `audit.spec.ts` | 4 | Table rendering, audit events, filter controls, page header |
| `usage.spec.ts` | 4 | Table rendering, KPI cards, filter controls, page header |
| `settings.spec.ts` | 7 | Tab navigation, form fields, save buttons, danger zone |
| `account.spec.ts` | 8 | Profile page, API key management, create/revoke |
| `navigation.spec.ts` | 10 | Sidebar navigation, collapse, topbar, workspace/project switchers, user menu |
| `ux-guardrails.spec.ts` | 5 | Login CTA, app shell structure, overflow, loading states, page indicators |
| `console-errors.spec.ts` | 3 | General console errors, hydration errors, network failures |
| `join.spec.ts` | 5 | Invitation flow (valid/invalid), locale coverage |
| `workspace-settings.spec.ts` | 5 | Workspace info and members |
| `interactions.spec.ts` | 12 | Notifications, language switch, dialogs, selection |

### Visual Regression Tests (29 tests)
Full-page screenshots for all pages and 7 dialog states:

**Pages:** login, join, workspace-select, projects-list, workspace-settings, overview, chat, AI Studio, agents, endpoints, credentials, members, sources, audit, usage, settings (2 tabs), profile, api-keys

**Dialogs:** create-project, create-agent, create-endpoint, create-credential, invite-member, upload-source, create-api-key

Baselines stored in `e2e/__screenshots__/visual.spec.ts/`.

---

## 2. Test Infrastructure

### Shared Fixtures (`e2e/fixtures/`)
- **`test-base.ts`**: Extended Playwright `test` with `authedPage` fixture, helper functions `goToProject()`, `goTo()`, `projectUrl()`
- **`authenticated.ts`**: `withAuth()` injects mock auth state into Zustand store via `addInitScript`
- **`routes.ts`**: Canonical route definitions with expected testIds

### MSW Mock Data (`src/mocks/`)
- **`fixtures/p0.json`**: Central mock data fixture with realistic data for all entities
- **`handlers/`**: Modular handlers for all API endpoints (auth, workspace, projects, agents, endpoints, credentials, members, sources, audit, usage, chat, recipes, user-keys, me)

### Playwright Config
- 3 projects: `smoke`, `chromium`, `visual`
- Visual regression: `maxDiffPixelRatio: 0.01`
- Screenshots stored at `e2e/__screenshots__/`
- Videos retained on failure

---

## 3. Component Fixes Made During Testing

1. **`AuditTable.tsx`**: Fixed null reference in `request_id` column - added null check before calling `truncateId()` on potentially undefined value
2. **i18n**: Added missing translation keys `endpoints.delete_confirm_title` and `endpoints.delete_confirm_description` to `en-US.json` and `zh-CN.json`

---

## 4. Running Tests

```bash
# Run all E2E tests
npx playwright test

# Run specific projects
npx playwright test --project=smoke
npx playwright test --project=chromium
npx playwright test --project=visual

# Update visual baselines
npx playwright test --project=visual --update-snapshots

# Run a specific test file
npx playwright test e2e/agents.spec.ts --project=chromium
```

---

## 5. data-testid Coverage

38+ test IDs added across 26+ component files. See `docs/UXUI/2026-02-05-前端-testid-规范.md` for the full specification.
