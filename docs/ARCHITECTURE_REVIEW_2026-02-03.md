# MBOS Frontend Architecture Review
**Date**: 2026-02-03
**Reviewer**: Claude (Architectural Analysis)
**Scope**: Structural best practices, architectural patterns, anti-patterns detection

---

## Executive Summary

The MBOS Frontend demonstrates **strong foundational architecture** with modern Next.js 15 patterns, clean separation of concerns, and well-implemented design systems. However, there are **significant architectural issues** that need attention:

| Category | Status | Priority |
|----------|--------|----------|
| API Layer | Excellent | Low |
| Design System | Excellent | Low |
| Type System | Excellent | Low |
| State Management | Needs Improvement | High |
| Component Architecture | Needs Improvement | High |
| Routing & Layouts | Needs Improvement | Medium |

---

## 1. API Layer Architecture

### Assessment: Excellent

The API layer is the **strongest part** of the architecture with professional-grade implementation.

**Strengths:**
- Clean adapter pattern with dual client (MSW/Fetch) implementation
- Proper separation between adapters, endpoints, and types
- Comprehensive error handling with user-friendly messages
- Well-implemented SSE support with proper reconnection logic
- Strong type safety throughout
- Environment-based switching for mock/real data

**Minor Issues:**
- Recipe types (`src/lib/types/recipe.ts`) not exported from main types file
- URLSearchParams building could be abstracted into a helper
- Unused validators in `src/lib/api/validators.ts`

**Recommendations:**
1. Export recipe types from `src/lib/api/types/index.ts` for consistency
2. Create a `buildQueryString(params)` utility to reduce duplication
3. Either use validators or remove them (currently unused)

**No structural workarounds detected.**

---

## 2. State Management Architecture

### Assessment: Needs Improvement (High Priority)

The `authStore` violates the **Single Responsibility Principle** by managing too many concerns.

### Critical Issue: Store Bloat

**Current Responsibilities in Single Store:**
- User authentication state
- Workspace management
- Project management
- Permissions (derived state)
- Mock data (development concerns mixed with production)
- URL synchronization logic

**Problem:**
```typescript
// src/lib/stores/authStore.ts - 315 lines doing too much
export interface AuthState extends AuthData {
  // Auth actions
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;

  // Workspace actions
  setWorkspace: (workspace: Workspace) => void;

  // Project actions
  setProject: (project: Project | null) => void;
  setProjects: (projects: Project[]) => void;
  clearProject: () => void;

  // Mock actions (should not be in production store)
  mockLogin: (workspaceId: string, userEmail: string, userName?: string) => void;
  mockLogout: () => void;
}
```

### Recommended Split:

```typescript
// Recommended store structure
stores/
├── auth/
│   └── authStore.ts          // User + token only
├── workspace/
│   └── workspaceStore.ts     // Workspaces + current workspace
├── project/
│   └── projectStore.ts       // Projects + current project
└── permissions/
    └── permissionStore.ts    // Derived permissions from auth/workspace/project
```

### Security Issue: Token Storage

**Current Implementation:**
```typescript
persist({
  name: 'mbos-auth',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    user: state.user,
    token: state.token,  // ❌ Vulnerable to XSS
    // ...
  }),
})
```

**Problems:**
- Token stored in localStorage (XSS vulnerable)
- Too much state persisted (entire projects array)
- No token expiration handling

**Recommendations:**
- Use HttpOnly cookies for token storage (requires backend support)
- Or use sessionStorage for tokens (cleared on browser close)
- Only persist essential data (user ID, token expiration)
- Implement token refresh mechanism

### State Synchronization Issues

**Race Condition in `useSyncAuthFromUrl`:**
```typescript
// Two separate effects without coordination
useEffect(() => { /* sync workspace */ }, [workspaceId]);
useEffect(() => { /* sync project */ }, [projectId, workspaceId]);
```

**Problems:**
- Effects can fire out of order
- No atomic update guarantee
- Hydration race conditions possible

**Recommendation:**
```typescript
// Single coordinated effect
useEffect(() => {
  // Atomic update of both workspace and project
  const updateContext = () => {
    if (workspaceId !== currentWorkspace?.?.id) {
      setWorkspace(workspace);
      clearProject();
    }
    if (projectId && projectId !== currentProject?.?.id) {
      const project = projects.find(p => p.id === projectId);
      if (project) setProject(project);
    }
  };
  updateContext();
}, [workspaceId, projectId]);
```

### React Query vs Zustand Overlap

**Problem:** Projects array stored in both:
- Zustand store (client state)
- React Query cache (server state)

**Recommendation:**
- Move workspace/project data entirely to React Query
- Keep only navigation state (currentWorkspaceId, currentProjectId) in Zustand
- This reduces duplication and sync issues

---

## 3. Component Architecture

### Assessment: Needs Improvement (High Priority)

### Issue 1: Oversized Components

**Examples of components that need splitting:**

| Component | Lines | Issues |
|-----------|-------|--------|
| `MembersPage.tsx` | 365 | Tabs, table, selection, 3+ dialogs, permissions, mutations |
| `SourcesPage.tsx` | 359 | Search, filters, pagination, upload, delete, SSE polling |
| `PermissionsEditor.tsx` | 228 | 2 modes, validation, dialogs, change tracking |
| `RecipePage.tsx` | 285 | SSE, streaming, artifacts, panels |

**Target Size:** Components should be 50-150 lines maximum.

**Recommended Refactor Pattern:**
```typescript
// Before: 365-line MembersPage
export function MembersPage() {
  // 15+ state variables
  // 300+ lines of logic
}

// After: Container + children
export function MembersPage() {
  const members = useMembers();
  return (
    <MembersPageLayout>
      <MembersTable members={members} />
      <MemberDetailDrawer />
      <InviteMemberDialog />
    </MembersPageLayout>
  );
}
```

### Issue 2: Props Drilling

**Example from `MembersPage`:**
```typescript
<MemberDetailDrawer
  member={selectedMember}
  permissions={permissions}
  projectGovernance={project?.governance_json}
  quotaOverrides={quotaOverrides}
  workspaceId={workspaceId}
  projectId={projectId}
  permissionTemplates={permissionTemplates}
  quotaTemplates={quotaTemplates}
  onSavePermissions={handleSavePermissions}
  onSaveQuota={handleSaveQuota}
  onViewHistory={...}
  // 11 props total
/>
```

**Recommended Solution: Context Providers**
```typescript
// Create project-level context
const ProjectContext = createContext({
  workspaceId: '',
  projectId: '',
  project: null,
  permissions: [],
  // ...
});

// Use in child components
function MemberDetailDrawer() {
  const { workspaceId, projectId, permissions } = useProjectContext();
  // No props needed
}
```

### Issue 3: Duplicate UI Patterns

**Dialog Pattern Duplication:**
Each dialog implements its own:
- `open` state management
- Loading/error handling
- Button layouts (Cancel/Confirm)
- Form validation

**Recommended Solution:**
```typescript
// Create reusable dialog wrapper
export function FormDialog<T>({
  title,
  onSubmit,
  renderForm,
  initialData,
}: FormDialogProps<T>) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const handleSubmit = async (data: T) => {
    setIsSubmitting(true);
    try {
      await onSubmit(data);
      setOpen(false);
    } catch (err) {
      setErrors(parseErrors(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>{title}</DialogHeader>
        {renderForm({ handleSubmit, isSubmitting, errors })}
      </DialogContent>
    </Dialog>
  );
}
```

**Table/Selection Pattern Duplication:**
- Selection state duplicated across `MembersTable`, `SourcesTable`, etc.
- Batch action bars have similar implementations

**Recommended Solution:**
```typescript
// Generic selection hook
export function useTableSelection<T>(items: T[], keyFn: (item: T) => string) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const allIds = new Set(items.map(keyFn));
    setSelectedIds(
      selectedIds.size === items.size ? new Set() : allIds
    );
  };

  const selectedItems = items.filter(item =>
    selectedIds.has(keyFn(item))
  );

  return { selectedIds, selectedItems, toggle, toggleAll };
}
```

### Issue 4: State Location Issues

**Example from `SourcesPage`:**
```typescript
// 15+ state variables in one component
const [search, setSearch] = useState('');
const [status, setStatus] = useState<AIReadyStatus | 'all'>('all');
const [aiReadyOnly, setAiReadyOnly] = useState(false);
const [sortBy, setSortBy] = useState<'updated_at' | 'file_size' | 'status'>('updated_at');
const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
// ... 8 more states
```

**Recommended Consolidation:**
```typescript
// Extract filter state into custom hook
function useSourcesFilters() {
  return useSearchParamsState({
    search: '',
    status: 'all' as const,
    aiReadyOnly: false,
    sortBy: 'updated_at' as const,
    sortOrder: 'desc' as const,
  });
}

// Extract dialog state into reducer or enum
type DialogState = { type: 'closed' } | { type: 'upload'; file?: File } | { type: 'delete', ids: string[] };
const [dialogState, setDialogState] = useState<DialogState>({ type: 'closed' });
```

---

## 4. Routing & Layout Architecture

### Assessment: Needs Improvement (Medium Priority)

### Issue 1: Over-Nested Layouts

**Current Structure (5-6 levels):**
```
app/
├── layout.tsx                                    // Level 1
├── [locale]/layout.tsx                          // Level 2
├── [locale]/workspaces/[workspace]/layout.tsx   // Level 3
├── [locale]/workspaces/[workspace]/projects/
│   ├── [project]/layout.tsx                     // Level 4
│   └── [project]/(app)/
│       ├── chat/layout.tsx                      // Level 5
│       ├── workbench/layout.tsx                 // Level 5
│       └── ...
```

**Problems:**
- Deep nesting makes reasoning about data flow difficult
- Each layout level adds React context overhead
- Props must pass through multiple layers

**Recommended Simplification:**
```
app/
├── layout.tsx                    // HTML structure + providers
├── [locale]/layout.tsx          // Locale + auth providers
├── [locale]/
│   ├── login/                   // Auth flow (no workspace context)
│   ├── workspaces/
│   │   ├── [workspace]/
│   │   │   ├── layout.tsx       // Workspace context + sync
│   │   │   ├── projects/        // Project list
│   │   │   └── settings/        // Workspace settings
│   │   └── projects/
│   │       └── [project]/
│   │           ├── layout.tsx   // Project app shell (sidebar + topbar)
│   │           ├── overview/
│   │           ├── chat/
│   │           ├── workbench/
│   │           └── ...
```

### Issue 2: Unnecessary Parallel Routes

**Current Pattern:**
```
/[locale]/workspaces/[workspace]/projects/[project]/(app)/{page}
```

The `(app)` route group adds no value since:
- No actual parallel routing happening
- Only contains sub-layouts that could be in the main layout
- Creates confusion in URL structure

**Recommendation:**
Remove the `(app)` route group entirely:
```
/[locale]/workspaces/[workspace]/projects/[project]/{page}
```

### Issue 3: URL Sync Hook Overuse

**`useSyncAuthFromUrl` called in multiple places:**
- `/projects/[project]/layout.tsx`
- `/projects/page.tsx`
- Potentially other layouts

**Problem:**
- Duplicated sync logic
- Can cause race conditions
- Unnecessary re-renders

**Recommendation:**
Centralize URL sync in appropriate layouts:
```typescript
// Single sync location per context level
// [workspace]/layout.tsx - syncs workspace from URL
// [project]/layout.tsx - syncs project from URL
```

### Issue 4: Missing Loading/Error States

**Current State:**
- No `loading.tsx` files anywhere
- No `error.tsx` files anywhere
- Poor UX for async navigation

**Recommendation:**
```typescript
// Add at appropriate levels
[locale]/workspaces/loading.tsx
[locale]/workspaces/[workspace]/loading.tsx
[locale]/workspaces/[workspace]/projects/[project]/loading.tsx
[locale]/workspaces/[workspace]/projects/[project]/error.tsx
```

---

## 5. Design System

### Assessment: Excellent

The design system is **well-implemented** with:
- RGB triplet tokens for alpha support
- Clear semantic naming
- Consistent spacing scale
- Proper component abstraction
- Good documentation

**No issues detected.**

---

## 6. Type System

### Assessment: Excellent

**Strengths:**
- No significant type duplication
- Clear separation between API types and component types
- Proper barrel exports
- Well-documented type contracts

**Minor Issue:**
- Recipe types should be exported from main types file for consistency

**No structural issues detected.**

---

## Summary of Recommendations

### High Priority (Architectural Impact)

1. **Split `authStore` into focused stores** (auth, workspace, project, permissions)
2. **Implement proper token storage** (HttpOnly cookies or sessionStorage)
3. **Break down oversized components** (target 50-150 lines per component)
4. **Create context providers** to eliminate props drilling
5. **Extract reusable UI patterns** (dialogs, tables, forms)

### Medium Priority (Quality of Life)

1. **Simplify layout nesting** (reduce from 5-6 to 3-4 levels maximum)
2. **Remove unnecessary parallel routes** (`(app)` route group)
3. **Centralize URL sync logic** (single location per context)
4. **Add loading/error states** for better UX
5. **Fix state synchronization** race conditions

### Low Priority (Polish)

1. **Export recipe types** from main types file
2. **Create `buildQueryString` utility** for API layer
3. **Remove or use validators** in `src/lib/api/validators.ts`
4. **Standardize caching strategies** across React Query hooks

---

## Anti-Patterns Detected

### Present in Codebase

| Anti-Pattern | Location | Severity |
|--------------|----------|----------|
| God Store | `authStore.ts` | High |
| Props Drilling | Throughout components | High |
| God Component | `MembersPage.tsx`, `SourcesPage.tsx`, `PermissionsEditor.tsx` | High |
| localStorage for sensitive data | `authStore.ts` persistence | High (Security) |
| Duplicate Code | Dialog implementations, table selection | Medium |
| Race Conditions | `useSyncAuthFromUrl.ts` | Medium |
| Over-Nesting | Layout structure | Medium |

### Not Present (Good Practices Followed)

- ✅ No direct DOM manipulation
- ✅ No prop types mixed with TypeScript
- ✅ No inline styles (design tokens used)
- ✅ No hardcoded values (constants properly defined)
- ✅ No ad-hoc state management (Zustand/React Query used consistently)
- ✅ No callback hell (async/await used)

---

## Conclusion

The MBOS Frontend has a **solid foundation** with excellent API layer, design system, and type safety. However, it suffers from:

1. **State management bloat** - Single store doing too much
2. **Component organization issues** - Oversized components with excessive props drilling
3. **Routing over-engineering** - Too much nesting and unnecessary parallel routes
4. **Security concerns** - Token storage in localStorage

These issues are **fixable without major rewrites**. The recommended approach is:

1. **Phase 1**: Split stores and fix token storage (foundational)
2. **Phase 2**: Break down components and create context providers (incremental)
3. **Phase 3**: Simplify routing structure (coordinated change)

The codebase shows **good engineering practices** overall and these improvements will make it more maintainable and scalable.
