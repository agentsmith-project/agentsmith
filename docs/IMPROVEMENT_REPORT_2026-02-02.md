# MBOS Frontend Improvement Report

**Date:** 2026-02-02  
**Scope:** Topbar User Menu, Branding Icons, Project CRUD, Sidebar UX, Workspace/Projects/User Management/Overview

---

## Executive Summary

This report analyzes five areas of the MBOS frontend and provides actionable recommendations. Key findings:

1. **User Menu** — All handlers are stubs (console.log); no Profile, API Keys, Language, or Logout implementation.
2. **Branding Icons** — Logo and Avatar use gradient fills that deviate from the design system's linear icon style.
3. **Project CRUD** — Create/Edit buttons exist but have no behavior; API layer is ready.
4. **Sidebar** — Fixed 260px feels wide; collapse toggle placement and affordance can be improved.
5. **Feature Gaps** — Workspace creation/settings, project edit/delete, user profile, and API keys management are missing.

---

## 1. Topbar User Menu — Implementation Status

### Current State

| Item | Handler | Implementation |
|------|---------|----------------|
| Profile | `handleProfile` | `console.log` only |
| API Keys | `handleApiKeys` | `console.log` only |
| Language | `handleLanguage` | `console.log` only |
| Logout | `handleLogout` | `console.log` only |

**File:** `src/components/app-shell/Topbar.tsx` (lines 96–114)

### Recommendations

#### 1.1 Profile
- **Option A:** Add `/user/profile` route for user profile (name, email, avatar, locale).
- **Option B:** Use a modal/drawer for quick profile edit (lighter weight).
- **Data:** Use `useAuthStore().user`; integrate with backend user API when available.

#### 1.2 API Keys (User API Keys)
- Add route: `/[locale]/user/api-keys` (user-scoped, not project-scoped).
- Reuse `user_keys` i18n namespace (already present in messages).
- API: `UserKeysAPI` exists in `src/lib/api/endpoints/user-keys.ts`.
- Wire `handleApiKeys` → `router.push(\`/${locale}/user/api-keys\`)`.

#### 1.3 Language
- Add locale switcher dropdown (en-US / zh-CN).
- Use `next-intl` locale switching: `useRouter().replace(pathname, { locale: newLocale })`.
- Persist preference in cookie/localStorage; `next-intl` supports this.

#### 1.4 Logout
- Call `useAuthStore().mockLogout()` (or `clearAuth()` when real auth exists).
- Redirect to `/[locale]/login`.
- Clear any project/workspace context.

### Implementation Priority

1. **Logout** — Highest; required for auth flow.
2. **API Keys** — High; core developer workflow.
3. **Language** — Medium; i18n completeness.
4. **Profile** — Medium; can start with read-only display.

---

## 2. App Icon & User Icon — Design Consistency

### Current State

- **Logo** (`Logo.tsx`): 32×32 div with `--ai-gradient` background, white "M" text.
- **Avatar** (`UserMenu.tsx`): 32×32 Avatar with `--ai-gradient` on fallback (initials).

### Design System Reference (视觉设计系统-v1.md)

- **Icon style:** Linear (outlined), 1.5–2px stroke.
- **Icon color:** Default `#C4C6CF`, active `#87A9FF`.
- **AI gradient:** `#B1C5FF` → `#076EFF` (90°), for "AI-specific features" and key titles.
- **Restraint:** "整个界面应以灰黑白为主，蓝色仅作为引导" (grayscale base, blue as accent).

### Issues

1. **Logo:** Solid gradient + bold "M" feels heavy; design system favors linear icons.
2. **Avatar:** Gradient fallback is fine for "AI user" branding, but may clash if used generically.
3. **Inconsistency:** Nav icons use linear Lucide; Logo/Avatar use filled gradients.

### Recommendations

#### 2.1 Logo
- **Option A:** Replace with linear "M" or abstract mark (SVG stroke, no fill).
- **Option B:** Keep gradient but reduce prominence: smaller icon, lighter weight.
- **Option C:** Use Sparkle icon (设计系统: "火花图标代表 AI 功能") as primary or secondary mark.

#### 2.2 Avatar
- **Option A:** Use `--icon-default` (#C4C6CF) for fallback when no avatar; reserve gradient for "AI" contexts.
- **Option B:** Keep gradient for fallback but add subtle border (`border-border`) for separation from background.
- **Option C:** Use `--bg-surface-high` for fallback; gradient only on hover/active.

#### 2.3 Unified Treatment
- Align Logo and Avatar: either both use gradient sparingly, or both use neutral fills with accent on hover/active.
- Ensure Topbar icons (Bell, User) share the same color token (`text-icon-default`).

---

## 3. Create & Edit Project — Missing Functionality

### Current State

- **Projects page:** "New Project" and "Create First" buttons have no `onClick`.
- **Project card/table:** Settings button has no navigation; no edit/delete actions.
- **API:** `ProjectAPI.create`, `ProjectAPI.update`, `ProjectAPI.delete` exist.

### Recommendations

#### 3.1 Create Project
- Add `CreateProjectDialog` component (or inline form).
- Fields: name (required), description (optional), visibility (public/private), join_policy.
- On submit: call `projectAPI.create(workspaceId, data)` → `setProjects([...projects, newProject])` → optionally `setProject(newProject)` and navigate to overview.
- Wire to both "New Project" and "Create First" buttons.

#### 3.2 Edit Project
- Add `EditProjectDialog` or navigate to `/[locale]/workspaces/[ws]/projects/[proj]/settings`.
- Settings page already exists; ensure it supports project name, description, visibility, join_policy.
- Wire Settings button in project card/table → `router.push(settingsPath)`.

#### 3.3 Delete Project
- Add delete action in project table/card (with confirmation).
- Call `projectAPI.delete(workspaceId, projectId)` → remove from store → redirect to projects list.

#### 3.4 Implementation Order
1. Create project dialog + API integration.
2. Settings page: ensure project update API is wired.
3. Settings button navigation from projects list.
4. Delete with confirmation.

---

## 4. Sidebar — Layout & Collapse Toggle

### Current State

- **Width:** 260px expanded, 72px collapsed (per design spec).
- **Toggle:** Top-right (or center when collapsed); `PanelLeftClose` / `PanelLeftOpen`.
- **Persistence:** `localStorage` key `mbos.sidebar.collapsed`.

### User Feedback
- "感觉有点太占地方" (feels too spacious).
- "伸缩toggle能不能优化?" (collapse toggle could be improved).

### Recommendations

#### 4.1 Reduce Expanded Width
- **Option A:** 260px → 220px. Design spec says 260px, but many tools use 200–220px for a tighter feel.
- **Option B:** 240px as compromise.
- **Option C:** Make width configurable (user preference).

#### 4.2 Collapse Toggle UX
- **Placement:** Move to bottom of sidebar (design spec: "用户头像、设置、API Key 等入口固定在底部"). Toggle fits naturally there.
- **Affordance:** Add tooltip on hover; consider chevron that rotates on collapse.
- **Animation:** Ensure `transition-[width] duration-200` is smooth; verify no layout jump.

#### 4.3 Collapsed State
- 72px is reasonable for icon-only; ensure icons are centered and labels show via tooltip.
- Consider hover-to-expand (peek) on collapsed state for quick navigation without full expand.

#### 4.4 Space Efficiency
- Reduce vertical padding (`py-4` → `py-2`) if needed.
- Reduce item height (40px → 36px) for denser layout.
- Group items (e.g., "Project" vs "Workspace" sections) with subtle dividers to reduce visual bulk.

---

## 5. Workspace, Projects, User Management & Overview — Feature Gaps

### 5.1 Workspace

| Feature | Status | Recommendation |
|---------|--------|----------------|
| Create workspace | Missing | Add "Create Workspace" in workspace switcher or dedicated page. |
| Workspace settings | Missing | `WORKSPACE_MENU_ITEMS` has `../settings` but no workspace-level settings route exists. Add `/[locale]/workspaces/[workspace]/settings`. |
| Workspace members | Missing | Workspace-level member management (owners, admins). |
| Switch workspace | Done | Topbar dropdown works. |

### 5.2 Projects

| Feature | Status | Recommendation |
|---------|--------|----------------|
| Create project | Missing | See §3. |
| Edit project | Missing | Wire Settings; ensure settings page supports update. |
| Delete project | Missing | Add delete + confirmation. |
| Pin/unpin | Done | Implemented. |
| Search | Done | Implemented. |

### 5.3 User Management (Project Members)

| Feature | Status | Recommendation |
|---------|--------|----------------|
| Members list | Done | MembersPage exists. |
| Permissions & quota | Done | Per design docs. |
| Invite member | Partial | "Invite" exists; ensure backend integration. |
| Join requests | Partial | "Coming soon" in some areas. |
| Block/unblock | Done | Actions exist. |

### 5.4 Overview

| Feature | Status | Recommendation |
|---------|--------|----------------|
| KPI cards | Done | Requests, errors, tokens, userdata. |
| Recent activity | Done | Audit events. |
| Quick navigation | Done | ProjectNavigation. |
| Empty state | Partial | Ensure graceful handling when no data. |
| Time range filter | Missing | Add for KPI/activity (e.g., last 7 days, 30 days). |

### 5.5 Cross-Cutting

- **Breadcrumb:** Topbar shows workspace/project; consider explicit breadcrumb for deep pages.
- **Notifications:** Bell icon has badge but no dropdown or page; low priority.
- **Keyboard shortcuts:** Not implemented; consider Cmd+K command palette later.

---

## Implementation Roadmap (Suggested)

### Phase 1 — Critical (1–2 sprints)
1. Logout implementation.
2. Create project dialog + API.
3. Settings button → project settings page.
4. Sidebar: move toggle to bottom, optionally reduce width.

### Phase 2 — High Value (1–2 sprints)
1. API Keys page (`/user/api-keys`).
2. Edit project (settings page wiring).
3. Delete project with confirmation.
4. Language switcher.

### Phase 3 — Polish (1 sprint)
1. Logo/Avatar design alignment.
2. Profile page or modal.
3. Workspace settings route.
4. Overview time range filter.

### Phase 4 — Future
1. Create workspace.
2. Workspace members.
3. Notification center.
4. Command palette (Cmd+K).

---

## Appendix: File References

| Area | Primary Files |
|------|----------------|
| User Menu | `Topbar.tsx`, `UserMenu.tsx` |
| Logo/Avatar | `Logo.tsx`, `UserMenu.tsx` |
| Projects | `projects/page.tsx`, `ProjectAPI` (endpoints/projects.ts) |
| Sidebar | `AppShellSidebar.tsx` |
| Settings | `(app)/settings/page.tsx` |
| Design System | `文档/UXUI/2026-01-31-视觉设计系统-v1.md`, `globals.css` |
