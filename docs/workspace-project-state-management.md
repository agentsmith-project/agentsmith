# Workspace & Project State Management - Design Document

## Overview

This document describes the state management logic for workspace and project selection in the Topbar, ensuring that the UI always reflects the current context and handles state transitions correctly.

## State Transfer Logic

### 1. Workspace Selection Flow

**Trigger**: User selects a workspace from the dropdown menu

**State Changes**:
1. Find the workspace object from `workspaces` array
2. Call `setWorkspace(newWorkspace)` → This automatically clears `currentProject` (via store logic)
3. Filter `allProjects` by `workspace_id` to get projects for the new workspace
4. Call `updateProjects(workspaceProjects)` to update the projects list
5. Navigate to `/workspaces/{new_workspace_id}/projects`

**Result**:
- `currentWorkspace` → New workspace
- `currentProject` → `null` (cleared)
- `projects` → Filtered list for new workspace
- URL → Project list page for new workspace

### 2. Project Selection Flow

**Trigger**: User selects a project from the dropdown menu

**State Changes**:
1. Verify `currentWorkspace` exists
2. Find the project object from filtered `projects` (current workspace only)
3. Verify project belongs to current workspace
4. Call `setProject(newProject)` to update store
5. Navigate to `/workspaces/{workspace_id}/projects/{new_project_id}/overview`

**Result**:
- `currentWorkspace` → Unchanged
- `currentProject` → New project
- `projects` → Unchanged (still filtered for current workspace)
- URL → Overview page for new project

### 3. URL-to-Store Synchronization

**Purpose**: Ensure store state matches URL parameters for:
- Direct URL navigation (deep links)
- Browser back/forward navigation
- Programmatic navigation

**Implementation**: `useSyncAuthFromUrl` hook

**Logic**:
1. **Workspace Sync**:
   - Extract `workspaceId` from URL params
   - Find workspace object
   - If different from `currentWorkspace`, update store
   - Filter and update projects for the workspace

2. **Project Sync** (only if workspace is set):
   - Extract `projectId` from URL params
   - Find project object (must belong to current workspace)
   - If different from `currentProject`, update store

**Usage**: Called in:
- Project list page (`/workspaces/{ws}/projects`)
- Project pages (`/workspaces/{ws}/projects/{prj}/...`)

## Key Design Decisions

### 1. Single Source of Truth
- **Store** (`authStore`) is the primary source of truth for `currentWorkspace` and `currentProject`
- **URL** parameters are synchronized to store via `useSyncAuthFromUrl` hook
- **Topbar** displays state from store, updates store on user actions

### 2. Workspace Change Clears Project
- When workspace changes, `currentProject` is automatically set to `null`
- This ensures users don't see a project from a different workspace
- Projects list is filtered to show only projects for the current workspace

### 3. Projects Filtering
- `allProjects` in store contains projects from all workspaces
- `projects` displayed in Topbar/UI is filtered by `currentWorkspace.id`
- When workspace changes, projects list is updated to show only relevant projects

### 4. State Synchronization Strategy
- **Topbar actions** (user clicks) → Update store first, then navigate
- **URL changes** (navigation) → Sync store from URL via hook
- This ensures consistency whether user clicks or navigates directly

## Implementation Details

### Topbar Component

```typescript
// Filter projects for current workspace
const projects = useMemo(() => {
  if (!currentWorkspace) return [];
  return allProjects.filter((p) => p.workspace_id === currentWorkspace.id);
}, [allProjects, currentWorkspace]);

// Workspace change handler
const handleWorkspaceChange = (workspaceId: string) => {
  const newWorkspace = workspaces.find((ws) => ws.id === workspaceId);
  setWorkspace(newWorkspace); // Clears currentProject
  const workspaceProjects = allProjects.filter((p) => p.workspace_id === workspaceId);
  updateProjects(workspaceProjects);
  router.push(`/${locale}/workspaces/${workspaceId}/projects`);
};

// Project change handler
const handleProjectChange = (projectId: string) => {
  const newProject = projects.find((p) => p.id === projectId);
  setProject(newProject);
  router.push(`/${locale}/workspaces/${currentWorkspace.id}/projects/${projectId}/overview`);
};
```

### useSyncAuthFromUrl Hook

```typescript
// Syncs store state from URL parameters
// Called in pages that have workspace/project in URL
export function useSyncAuthFromUrl() {
  // Sync workspace from URL
  useEffect(() => {
    if (workspaceId && workspaces) {
      const workspaceFromUrl = workspaces.find((ws) => ws.id === workspaceId);
      if (workspaceFromUrl && currentWorkspace?.id !== workspaceFromUrl.id) {
        setWorkspace(workspaceFromUrl);
        const workspaceProjects = allProjects.filter((p) => p.workspace_id === workspaceId);
        updateProjects(workspaceProjects);
      }
    }
  }, [workspaceId, workspaces, currentWorkspace]);

  // Sync project from URL (only after workspace is synced)
  useEffect(() => {
    if (projectId && currentWorkspace) {
      const projectFromUrl = allProjects.find(
        (p) => p.id === projectId && p.workspace_id === currentWorkspace.id
      );
      if (projectFromUrl && currentProject?.id !== projectFromUrl.id) {
        setProject(projectFromUrl);
      }
    }
  }, [projectId, currentWorkspace, allProjects, currentProject]);
}
```

## State Transition Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Initial State                         │
│  currentWorkspace: null                                 │
│  currentProject: null                                   │
│  projects: []                                           │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              User Selects Workspace                     │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 1. setWorkspace(newWorkspace)                      │ │
│  │    → currentWorkspace = newWorkspace              │ │
│  │    → currentProject = null (auto-cleared)         │ │
│  │ 2. updateProjects(filtered by workspace_id)        │ │
│  │ 3. Navigate to /workspaces/{ws}/projects          │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              User Selects Project                       │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 1. setProject(newProject)                          │ │
│  │    → currentProject = newProject                   │ │
│  │    → currentWorkspace unchanged                    │ │
│  │ 2. Navigate to /workspaces/{ws}/projects/{prj}/.. │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              User Changes Workspace Again               │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 1. setWorkspace(newWorkspace)                      │ │
│  │    → currentWorkspace = newWorkspace              │ │
│  │    → currentProject = null (auto-cleared)        │ │
│  │ 2. updateProjects(filtered by new workspace_id)   │ │
│  │ 3. Navigate to /workspaces/{new_ws}/projects      │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Best Practices

1. **Always update store before navigation**: This ensures UI reflects changes immediately
2. **Filter projects by workspace**: Never show projects from other workspaces
3. **Clear project on workspace change**: Prevents showing invalid state
4. **Sync from URL as fallback**: Handles direct navigation and browser history
5. **Validate relationships**: Always verify project belongs to workspace before setting

## Future Improvements

1. **API Integration**: Replace mock data filtering with actual API calls
2. **Loading States**: Show loading indicators during workspace/project switching
3. **Error Handling**: Handle cases where workspace/project doesn't exist
4. **Caching**: Cache projects per workspace to avoid refetching
5. **Optimistic Updates**: Update UI immediately, rollback on error
