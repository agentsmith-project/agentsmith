# Type Organization Rules

This directory contains frontend-specific type definitions that are not part of the API contract.

## Directory Structure

### `lib/api/types/`
**Purpose**: API contract types that match the backend schema.

**Contents**:
- Types that represent data structures exchanged with the backend
- Request/Response types for API endpoints
- Types that must match backend contracts exactly

**Examples**:
- `UsageRecord`, `AuditEvent` (from backend API)
- `FileItem` (matches backend schema)
- `PaginationParams`, `PaginatedResponse` (API contract)

### `lib/types/`
**Purpose**: Frontend-specific types that are not part of the API contract.

**Contents**:
- Component prop types
- UI state types
- Local data transformation types
- Frontend-only utility types

**Examples**:
- `Task`, `TaskActivityItem`, `Artifact` (if these are frontend-only transformations)
- Component-specific prop interfaces

## Migration Notes

If a type is used by both frontend and backend (e.g., `Task`), it should be placed in `lib/api/types/` to ensure consistency with the backend contract.

If a type is only used in the frontend (e.g., component props, local state), it can remain in `lib/types/`.

## Decision Tree

1. **Is this type part of the API contract?**
   - Yes → `lib/api/types/`
   - No → Continue to step 2

2. **Is this type only used in frontend components/state?**
   - Yes → `lib/types/`
   - No → Re-evaluate (might be API contract)

## Index Files

- `lib/api/types/index.ts` - Re-exports all API types
- `lib/types/index.ts` - Re-exports all frontend types (if needed)
