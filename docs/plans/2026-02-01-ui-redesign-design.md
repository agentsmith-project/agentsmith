# MBOS Frontend UI/UX Redesign Design Document
**Date:** 2026-02-01
**Version:** 2.0
**Status:** Design Complete, Ready for Implementation

## Executive Summary

Complete UI/UX redesign aligning with Google NotebookLM design language and the defined visual design system. Key changes include workspace/project navigation flow, TanStack Table integration for management pages, and strict adherence to the design tokens specified in `2026-01-31-视觉设计系统-v1.md`.

## Table of Contents

1. [Architecture & Routing](#1-architecture--routing)
2. [Navigation Flow](#2-navigation-flow)
3. [Design System Implementation](#3-design-system-implementation)
4. [Component Specifications](#4-component-specifications)
5. [Page Layouts](#5-page-layouts)
6. [Implementation Priority](#6-implementation-priority)

---

## 1. Architecture & Routing

### Current Route Structure

```
/[locale]/login                    → Email entry (Step 1)
/[locale]/login/workspace          → Workspace selection (Step 2)
/[locale]/workspaces/:workspaceId  → Projects list (main landing)
/[locale]/workspaces/:workspaceId/projects/:projectId/* → Project-scoped routes
```

### Key Changes from Current Implementation

| Area | Current | New |
|------|---------|-----|
| Login flow | Single screen | Two-step (Email → Workspace) |
| Landing after login | Overview (requires project) | Projects list |
| Workspace switching | Not available / via logout | Dropdown in topbar |
| Project switching | Via navigation | Dropdown in topbar |
| Sidebar | Always visible | Context-aware (hidden without project) |

### State Management Updates

```typescript
interface AuthState {
  user: User;
  currentWorkspace: Workspace;     // Selected at login, switchable during session
  currentProject?: Project;         // Switchable during session
  workspaces: Workspace[];
  projects: Project[];
}
```

---

## 2. Navigation Flow

### Complete User Journey

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Login     │ ──▶ │ Workspace Select │ ──▶ │  Projects   │
│  (Email)    │     │  (Grid Layout)   │     │   (Hybrid)  │
└─────────────┘     └──────────────────┘     └──────┬──────┘
                                                   │
                                                   ▼
                                            ┌─────────────┐
                                            │   Overview  │
                                            │  (Project)  │
                                            └──────┬──────┘
                                                   │
              ┌────────────────────────────────────┼────────────────────────────────────┐
              ▼                                    ▼                                    ▼
       ┌─────────────┐                      ┌─────────────┐                      ┌─────────────┐
       │    Chat     │                      │ Workbench   │                      │   Sources   │
       │(3-column)   │                      │(3-column)   │                      │(3-column)   │
       └─────────────┘                      └─────────────┘                      └─────────────┘
```

### Workspace Selection

- **Required at login** - User cannot proceed without selecting a workspace
- **Switchable during session** - Via topbar dropdown (no logout required)
- **Always visible in topbar** - Shows current workspace, indicator only

### Project Selection

- **Required for project-scoped features** - Chat, Workbench, Sources, Agents, etc.
- **Switchable during session** - Via topbar dropdown
- **Dropdown shows current state** - Project name OR "No project" (disabled when not applicable)

---

## 3. Design System Implementation

### CSS Variables (Semantic Mapping)

Created semantic Tailwind class names mapped to design document colors:

```css
/* src/styles/globals.css */
@layer base {
  :root {
    /* Surfaces (from design doc #191919, #1f1f1f, #252525, #2a2a2a) */
    --background: 191 191 191;      /* #191919 - base */
    --surface: 31 31 31;            /* #1f1f1f - container low */
    --surface-high: 37 37 37;       /* #252525 - container high */
    --surface-hover: 42 42 42;      /* #2a2a2a - container highest */

    /* Text (from design doc) */
    --foreground: 255 255 255;      /* #ffffff - primary */
    --foreground-secondary: 198 198 201;  /* #c6c6c9 - secondary */
    --foreground-muted: 140 140 140;       /* #8c8c8c - tertiary */

    /* Border (from design doc) */
    --border: 51 51 51;              /* #333 */
    --border-subtle: 38 38 38;      /* #262626 */

    /* Accent (from design doc gradient) */
    --accent: 135 169 255;          /* #87a9ff - interactive blue */
    --accent-gradient: linear-gradient(50deg, rgb(52,107,241) 33%, rgb(49,134,255) 48%, rgb(79,160,255) 65%);

    /* Semantic (from design doc) */
    --success: 61 219 133;           /* #3ddb85 - green for active/completed */
    --info: 135 169 255;            /* #87a9ff - blue for running/processing */
    --warning: 255 185 92;          /* #ffb95c - orange for paused/pending */
    --error: 255 180 171;           /* #ffb4ab - red for failed/offline */

    /* Radius (from design doc: 8px, 12px, 24px) */
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 24px;
  }
}
```

### Tailwind Configuration

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--background))',
        surface: 'rgb(var(--surface))',
        'surface-high': 'rgb(var(--surface-high))',
        'surface-hover': 'rgb(var(--surface-hover))',
        foreground: 'rgb(var(--foreground))',
        'foreground-secondary': 'rgb(var(--foreground-secondary))',
        'foreground-muted': 'rgb(var(--foreground-muted))',
        border: 'rgb(var(--border))',
        'border-subtle': 'rgb(var(--border-subtle))',
        accent: 'rgb(var(--accent))',
        success: 'rgb(var(--success))',
        warning: 'rgb(var(--warning))',
        error: 'rgb(var(--error))',
      },
      borderRadius: {
        'sm': 'var(--radius-sm)',
        'md': 'var(--radius-md)',
        'lg': 'var(--radius-lg)',
        '3xl': '24px',  // For prompt input capsule
      },
      spacing: {
        '18': '4.5rem',  // 72px - for 44px touch targets with padding
      },
    },
  },
}
```

### Design Principles (Strict Adherence)

1. **No visible divider lines** - Use spacing and background micro-differences instead
2. **Weak shadows only** - `v3-shadow-xs/sm/md` from design doc
3. **Focus rings required** - All interactive elements must have visible `focus-visible:ring-2 ring-accent/50`
4. **Touch targets** - Minimum 44x44px for accessibility
5. **Animation duration** - 150-300ms using `transition-all duration-200`
6. **Spacing** - 4px base unit: 4px, 8px, 16px, 24px, 32px

---

## 4. Component Specifications

### 4.1 Topbar

**Location:** Fixed header, 56px height (`h-14`)

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ [Logo]  [Workspace ▼]  [Project ▼]        [User Menu ▼]       │
└─────────────────────────────────────────────────────────────────┘
```

**Specifications:**
- Background: `bg-surface` (#1f1f1f)
- Border-bottom: `border-border` (#333)
- Workspace dropdown: Always enabled, shows current workspace
- Project dropdown: Disabled when no project selected, shows "No project"
- All dropdowns: `focus-visible:ring-2 ring-accent/50`

### 4.2 Sidebar

**Width:** 240px (`w-60`)
**Behavior:** Context-aware

| State | Menu Items | Visibility |
|-------|-----------|------------|
| No project selected | Projects, Settings | Visible |
| Project selected | Overview, Chat, Workbench, Sources, Agents, Endpoints, Members, Settings | Visible |

**Specifications:**
- Background: `var(--color-v3-surface-left-nav)`
- Border-right: `var(--color-v3-surface-left-nav-border)`
- Row height: ~40px (`py-2.5` + icon)
- Active indicator: 4px wide blue bar on left (`var(--color-v3-text-link)`)
- Hover: `bg-surface-hover`
- Focus: `focus-visible:ring-2 ring-accent/50`

### 4.3 TanStack Table (Base Component)

**File:** `src/components/ui/data-table.tsx`

**Specifications:**
```tsx
<div className="rounded-md overflow-hidden border border-border bg-surface"
     style={{ boxShadow: 'var(--v3-shadow-sm)' }}>
  <table className="w-full border-collapse">
    {/* Header: bg-surface-high, NO border-bottom */}
    <thead className="bg-surface-high">
      <th className="px-4 py-4 text-left text-sm font-medium text-foreground-secondary">
        {/* py-4 = 16px per spacing spec */}
    </thead>

    {/* Body: NO divide-y (use hover instead) */}
    <tbody>
      <tr className="hover:bg-surface-hover transition-colors duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
        <td className="px-4 py-4 text-sm text-foreground">
    </tbody>
  </table>
</div>
```

**Key Points:**
- No divider lines between rows (violates "spacing over lines" principle)
- Hover background change instead
- 16px padding (py-4) for accessibility
- Focus ring for keyboard navigation

### 4.4 Status Badge

**Uses container + on-color pattern from design doc:**

```tsx
const styles = {
  active: {
    backgroundColor: 'var(--color-tertiary-green)',
    color: 'var(--color-on-tertiary-green)',
  },
  paused: {
    backgroundColor: 'var(--color-tertiary-container)',
    color: 'var(--color-on-tertiary-container)',
  },
  error: {
    backgroundColor: 'var(--color-error-container)',
    color: 'var(--color-on-error-container)',
  },
};
```

### 4.5 Card Component

**Used for:** Pinned projects, workspace selection

**Specifications:**
```tsx
<div className="relative group bg-surface border border-border rounded-md p-6
              transition-all duration-200 hover:bg-surface-hover
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
     style={{ boxShadow: 'var(--v3-shadow-sm)' }}>
  {/* Content */}
</div>
```

- Radius: 12px (`rounded-md`)
- Padding: 24px (`p-6`)
- Shadow: `v3-shadow-sm`
- Hover: Background change + shadow increase

### 4.6 Input (Prompt/Email)

**Large capsule style per design doc:**

```tsx
<input
  className="w-full px-6 py-4 rounded-3xl text-foreground
             border border-transparent
             focus:border-accent focus:outline-none
             focus:ring-2 focus:ring-accent/50
             transition-all"
  style={{
    backgroundColor: 'var(--color-v3-surface-container-highest)', // #2a2a2a
    borderRadius: '24px',
  }}
/>
```

- Radius: 24px (capsule)
- Background: `#2a2a2a` (container-highest)
- Focus: Light blue ring + border

### 4.7 Button (Primary CTA)

```tsx
<button
  className="w-full py-4 rounded-lg text-white font-medium
             transition-all duration-200 hover:opacity-90
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
  style={{
    background: 'var(--color-gemini-product-gradient)',
    borderRadius: 'var(--radius-sm)', // 8px
  }}
>
  Continue
</button>
```

- Gradient: 50deg from design doc
- Radius: 8px
- Hover: 90% opacity

### 4.8 Dropdown Menu Item

```tsx
function MenuItem({ children, onClick, className }) {
  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 text-sm cursor-pointer
                  transition-colors duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        className || 'text-foreground hover:bg-surface-hover'
      }`}
    >
      {children}
    </div>
  );
}
```

### 4.9 Slider (Parameter Control)

```tsx
<input
  type="range"
  className="w-full h-1 bg-surface-high rounded-full appearance-none cursor-pointer"
  style={{ accentColor: 'var(--color-v3-text-link)' }}
/>
```

---

## 5. Page Layouts

### 5.1 Projects List Page

**Route:** `/workspaces/:workspaceId/projects`

**Layout Structure:**
```
┌──────────────────────────────────────────────────────────────────────┐
│ [Workspace ▼] [Project ▼]                    [+ New Project]        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  ⭐ Pinned Projects                                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │ │
│  │  │ Card 1   │  │ Card 2   │  │ Card 3   │                      │ │
│  │  └──────────┘  └──────────┘  └──────────┘                      │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  All Projects ─────────────────────────────────────────────────   ⚙️ │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ │ TanStack Table with virtualization                          │ │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Components:**
- Pinned section: Grid of cards (3 columns on large screens)
- All projects: TanStack Table with sort/filter/pagination
- "New Project" button: Top-right, gradient background

### 5.2 Three-Column Layout (Chat & Workbench)

**Applies to:** Chat, Workbench, Sources pages

**Dimensions:**
- Left (Sources): 240px
- Center (Canvas): flex-1
- Right (Context): 300px

**Implementation:**
```tsx
<div className="flex h-[calc(100vh-3.5rem)]"> {/* h-14 = topbar */}
  {/* Left: Sources */}
  <aside className="w-60 border-r border-border-subtle bg-surface">
    <SourcesPanel />
  </aside>

  {/* Center: Canvas */}
  <main className="flex-1 bg-background">
    {children}
  </main>

  {/* Right: Context */}
  <aside className="w-[300px] border-l border-border bg-surface">
    <ContextPanel />
  </aside>
</div>
```

### 5.3 Management Pages

**Pages:** Agents, Endpoints, Sources, Members, Audit, Usage

**Common Pattern:**
- TanStack Table with virtualization
- Contextual columns per page type
- Inline actions (via dropdown menu)
- Sortable, filterable
- Status badges with semantic colors

**Column Examples:**

| Page | Columns |
|------|----------|
| Agents | Name (icon + text), Model, Temp, Status, Last Used, Actions |
| Endpoints | Name, URL, Method, Rate Limit, Status, Actions |
| Sources | Name (icon + type), Size, Uploaded, Status, Actions |
| Members | Name, Email, Role, Joined, Actions |
| Audit | Timestamp, User, Action, Resource, Details |
| Usage | Date, Requests, Tokens, Cost, Breakdown |

---

## 6. Implementation Priority

### Phase 1: Foundation (Week 1)

1. **Design System Setup**
   - [ ] Create `src/styles/design-tokens.css` with all CSS variables
   - [ ] Update `tailwind.config.ts` with semantic color mappings
   - [ ] Update `globals.css` with base layer

2. **Core Components**
   - [ ] Button component (all variants)
   - [ ] Input component (prompt style)
   - [ ] Status badge component
   - [ ] Card component
   - [ ] Dropdown menu components
   - [ ] MenuItem component

3. **Navigation**
   - [ ] Topbar with workspace/project switchers
   - [ ] Context-aware sidebar
   - [ ] Update routing structure

### Phase 2: Pages & Layouts (Week 2)

4. **Authentication Flow**
   - [ ] Login page (email input)
   - [ ] Workspace selection page
   - [ ] Update auth store for workspace state

5. **Projects List**
   - [ ] Hybrid layout (pinned cards + table)
   - [ ] TanStack Table integration
   - [ ] "New Project" modal

6. **Three-Column Layouts**
   - [ ] Chat page with Sources/Context panels
   - [ ] Workbench page with Sources/Context panels
   - [ ] Sources panel (left)
   - [ ] Context panel (right) with sliders

### Phase 3: Management Pages (Week 2-3)

7. **Table Implementation**
   - [ ] Base DataTable component
   - [ ] Agents page
   - [ ] Endpoints page
   - [ ] Sources page (renamed from userdata)
   - [ ] Members page
   - [ ] Audit page
   - [ ] Usage page

8. **Overview Page**
   - [ ] Update to remove from landing flow
   - [ ] Only accessible after project selection

### Phase 4: Polish & Testing (Week 3)

9. **Design System Compliance**
   - [ ] Audit all components for focus rings
   - [ ] Remove all divider lines (use spacing)
   - [ ] Verify all shadows use v3-shadow-* tokens
   - [ ] Check all animations are 150-300ms

10. **E2E Test Updates**
    - [ ] Update tests for new login flow
    - [ ] Update tests for workspace switching
    - [ ] Update tests for new routing structure
    - [ ] Add tests for TanStack Table interactions

---

## 7. Technical Notes

### Renaming Changes

| Old Name | New Name | Reason |
|----------|----------|--------|
| userdata | sources | Align with Google NotebookLM terminology |
| /workspaces/:workspaceId/projects/:projectId/userdata | /.../sources | Consistent naming |

### Dependencies to Install

```bash
npm install @tanstack/react-table
```

### Files to Create

```
src/
├── styles/
│   └── design-tokens.css          # CSS variables from design doc
├── components/
│   ├── ui/
│   │   ├── data-table.tsx         # TanStack Table wrapper
│   │   ├── status-badge.tsx       # Status badge component
│   │   ├── parameter-slider.tsx   # Slider for context panel
│   │   └── dropdown-menu.tsx      # Updated with focus rings
│   ├── app-shell/
│   │   ├── topbar.tsx             # NEW: workspace + project switchers
│   │   ├── sidebar.tsx            # UPDATED: context-aware
│   │   └── sources-panel.tsx      # NEW: left panel for 3-column
│   └── dashboard/
│       └── context-panel.tsx      # NEW: right panel for 3-column
```

### Files to Modify

```
src/
├── app/
│   ├── [locale]/
│   │   ├── login/
│   │   │   └── page.tsx                   # Updated: email only
│   │   └── login/workspace/
│   │       └── page.tsx                   # NEW: workspace selection
│   ├── workspaces/
│   │   └── [workspace]/
│   │       ├── projects/
│   │       │   ├── page.tsx              # Updated: hybrid layout
│   │       │   └── [project]/
│   │       │       ├── (app)/
│   │       │       │   ├── chat/
│   │       │       │   │   ├── layout.tsx  # NEW: 3-column layout
│   │       │       │   │   └── page.tsx
│   │       │       │   ├── workbench/
│   │       │       │   │   ├── layout.tsx  # NEW: 3-column layout
│   │       │       │   │   └── page.tsx
│   │       │       │   ├── sources/        # Renamed from userdata
│   │       │       │   │   ├── layout.tsx  # NEW: 3-column layout
│   │       │       │   │   └── page.tsx
│   │       │       │   ├── agents/
│   │       │       │   │   └── page.tsx    # Updated: TanStack Table
│   │       │       │   ├── endpoints/
│   │       │       │   │   └── page.tsx    # Updated: TanStack Table
│   │       │       │   ├── members/
│   │       │       │   │   └── page.tsx    # Updated: TanStack Table
│   │       │       │   ├── audit/
│   │       │       │   │   └── page.tsx    # Updated: TanStack Table
│   │       │       │   ├── usage/
│   │       │       │   │   └── page.tsx    # Updated: TanStack Table
│   │       │       │   └── overview/
│   │       │       │       └── page.tsx    # No longer landing page
│   │       │       └── layout.tsx          # Updated: project context
├── lib/
│   ├── stores/
│   │   └── authStore.ts                  # Updated: workspace switching
│   └── api/
│       └── client.ts                     # May need updates for new flow
└── components/
    └── app-shell/
        └── AppShellSidebar.tsx           # Updated: context-aware
```

---

## 8. Design Compliance Checklist

### Before Considering Implementation Complete:

- [ ] All interactive elements have visible focus rings (`focus-visible:ring-2 ring-accent/50`)
- [ ] No visible divider lines in tables (use hover background instead)
- [ ] All shadows use `v3-shadow-xs/sm/md/lg` tokens
- [ ] All transitions specify `duration-200` (within 150-300ms range)
- [ ] All spacing uses 4px base unit (4, 8, 12, 16, 24, 32px)
- [ ] All border radius uses design spec values (8, 12, 24px)
- [ ] Prompt inputs use 24px radius and `#2a2a2a` background
- [ ] Primary buttons use gradient with 50deg angle
- [ ] Status badges use container + on-color pattern
- [ ] Touch targets are minimum 44x44px
- [ ] Topbar shows both workspace and project switchers
- [ ] Sidebar is context-aware (different items for workspace vs project)
- [ ] Three-column layouts use exact dimensions (240px / flex-1 / 300px)
- [ ] TanStack Tables have 16px padding and no divider lines
- [ ] All colors use semantic Tailwind classes mapping to design tokens

---

## Appendix: Design Token Reference

See full token list in: `/docs/UXUI/2026-01-31-视觉设计系统-v1.md`

Key tokens used:
- Surfaces: `--color-v3-surface`, `--color-v3-surface-container*`
- Text: `--color-v3-text`, `--color-v3-text-var`
- Accent: `--color-gemini-product-gradient`
- Semantic: `--color-tertiary-green`, `--color-error`, `--color-tertiary`
- Shadows: `--v3-shadow-xs/sm/md/lg`

---

**Document Status:** ✅ Design Complete, Ready for Implementation Planning
