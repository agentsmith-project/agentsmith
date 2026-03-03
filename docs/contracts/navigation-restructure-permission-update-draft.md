# Navigation Restructure - Permission Model Update Draft

> Prepared by: Dev-4
> Date: 2026-03-02
> Status: DRAFT - Pending WP-01, WP-02, WP-03, WP-04 completion

## Purpose

This document outlines the required updates to permission contracts for the navigation restructure from:
- **Before**: Home + Build + Govern + Operate
- **After**: Home + Use + Develop + Govern + Operate

## Updates Required

### 1. `auth-permission-model.md` Updates

Add new Section definitions:

```markdown
## Frontend Navigation Sections

| Section | Description | Pages |
|---------|-------------|-------|
| `home` | Overview and landing | Overview |
| `use` | End-user daily AI tools | Chat, Notebook, Files |
| `develop` | Developer agent building | Agents |
| `govern` | Configuration and policy | Endpoints, Resource Policy, Credentials, Members, Usage, Audit, Settings |
| `operate` | Runtime operations | Runtime Console (merged) |
```

### 2. `frontend-backend-gating-matrix.md` Updates

#### 2.1 Section Migration Table

| Page | Old Section | New Section | Permission (unchanged) |
|------|-------------|-------------|------------------------|
| Chat | Build | Use | `project:endpoint:use` |
| Notebook | Build | Use | `project:endpoint:use` |
| Files | Build | Use | `project:endpoint:use` |
| Agents | Build | Develop | `project:agent:manage`, `project:agent:manage` |
| Endpoints | Build | Govern | `project:endpoint:use`, `project:manage` |
| Settings | Operate | Govern | `project:manage` |
| Runtime Control Plane | Operate | Operate | `project:manage` |
| Runtime Observability | Operate | Operate | `project:endpoint:use` |
| Release Ops | Operate | Operate | `project:endpoint:use` |
| Alerts | Operate | Operate | `project:endpoint:use` |

#### 2.2 New Runtime Console Entry

Add to `frontend-backend-gating-matrix.md` Matrix:

| Page | User Operation | Required Permission(s) | Backend API Group | FE Expected on 403 |
|------|----------------|------------------------|-------------------|-------------------|
| runtime console | view overview tab | `project:manage` | `GET /projects/{id}`, `GET /runtime/health` | tab-level permission denied |
| runtime console | view monitoring tab | `project:endpoint:use` | `GET /runtime/metrics`, `GET /runtime/traces` | tab-level permission denied |
| runtime console | view alerts tab | `project:endpoint:use` | `GET /alert-rules`, `GET /alert-notifications` | tab-level permission denied |
| runtime console | view control tab | `project:endpoint:use` | `GET /release-ops/*`, `GET /governance/*` | tab-level permission denied |
| runtime console | view reports tab | `project:endpoint:use` | `GET /release-reports` | tab-level permission denied |

### 3. Route Redirect Entries

For documentation purposes, add redirect mapping:

| Old Route | New Route | Tab (if applicable) |
|-----------|-----------|-------------------|
| `/runtime-control-plane` | `/runtime-console` | `overview` |
| `/runtime-observability` | `/runtime-console` | `monitoring` |
| `/release-ops` | `/runtime-console` | `control` |
| `/alerts` | `/runtime-console` | `alerts` |

### 4. Permission Point Validation

All permission points remain unchanged. Only the Section grouping changes:

| Permission Point | Old Section | New Section |
|------------------|-------------|-------------|
| `project:endpoint:use` | Build | Use |
| `project:endpoint:use` | Build | Use |
| `project:endpoint:use` | Build | Use |
| `project:manage` | Build | Use |
| `project:agent:manage` | Build | Develop |
| `project:agent:manage` | Build | Develop |
| `project:endpoint:use` | Build | Govern |
| `project:manage` | Build | Govern |
| `project:manage` | Operate | Govern |

## Testing Checklist

After applying these updates:

- [ ] Run `npm run contracts:check` - should pass
- [ ] Run `npm run contracts:check-openapi` - should pass
- [ ] Verify all new routes have proper permission gates
- [ ] Verify Runtime Console tabs have correct permission checks

## Implementation Notes

1. **Permission Points Unchanged**: No new permission points are introduced. The change is purely organizational (section grouping).

2. **Tab-Level Permissions**: Runtime Console implements tab-level permission checks. Users may see the console but have different tabs enabled/disabled based on their permissions.

3. **Backward Compatibility**: The permission system itself is unchanged. Existing tokens and permission grants remain valid.

## Related Documents

- `docs/plans/next-mainline-execution-hold-plan-v1.md` - Full navigation restructure plan
- `docs/contracts/auth-permission-model.md` - To be updated
- `docs/contracts/frontend-backend-gating-matrix.md` - To be updated
- `src/lib/constants/permissions.ts` - Source of truth for permission points (unchanged)
