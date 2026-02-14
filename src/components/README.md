# Components Directory

This directory contains all React components for the MBOS frontend application.

## Directory Structure

### `components/ui/`
**Purpose**: Base UI components from shadcn/ui.

**Contents**:
- Reusable, unstyled components (Button, Input, Select, etc.)
- These are the building blocks for all other components
- Should not contain business logic

**Usage**: Import from `@/components/ui/{component-name}`

### `components/{module}/`
**Purpose**: Module-specific components.

**Examples**:
- `components/files/` - Files module components
- `components/notebook/` - Notebook / Task module components
- `components/audit-usage/` - Audit & Usage module components

### Shared Components

Some components are shared across multiple modules:

#### `components/audit-usage/TimeRangePicker.tsx`
**Purpose**: Time range selection with presets.

**Usage**: Used in Audit and Usage pages for filtering by time range.

**Props**:
- `value`: `{ start_time: string, end_time: string }`
- `onChange`: `(range: TimeRange) => void`
- `presets`: `'audit' | 'usage'` (different preset options)

#### `components/audit-usage/JSONViewer.tsx`
**Purpose**: Display JSON data in a collapsible tree view.

**Usage**: Used in Audit detail drawer to display `metadata_json`.

**Props**:
- `data`: `Record<string, unknown>`
- `className?`: `string`

#### `components/audit-usage/EmptyState.tsx`
**Purpose**: Display empty states with optional action buttons.

**Usage**: Used in tables and lists when no data is available.

**Props**:
- `title`: `string`
- `description?`: `string`
- `action?`: `{ label: string, onClick: () => void }`
- `onClearFilters?`: `() => void`

## Component Creation Guidelines

### When to Create a New Component

1. **Reusability**: If the same UI pattern is used in 2+ places, extract to a component
2. **Complexity**: If a component exceeds ~200 lines, consider splitting
3. **State Isolation**: If a piece of UI has its own state, it's a good candidate for a component

### When NOT to Create a Component

1. **One-time use**: If code is only used once and unlikely to be reused
2. **Simple markup**: If it's just a few lines of JSX, inline it
3. **Over-abstraction**: Don't create components for every small piece of UI

### Component Naming

- Use PascalCase: `TaskList.tsx`, `FileSelectDialog.tsx`
- Be descriptive: `TaskCreateDialog` not `CreateDialog`
- Match file name to component name

### Component Structure

```typescript
'use client'; // If using hooks or client-side features

import * as React from 'react';
import { useTranslations } from 'next-intl';
// ... other imports

export interface ComponentNameProps {
  // Props definition
}

export function ComponentName({ prop1, prop2 }: ComponentNameProps) {
  const t = useTranslations('module');
  
  // Hooks
  // State
  // Effects
  // Handlers
  // Render
  return (
    // JSX
  );
}
```

## Best Practices

1. **Use TypeScript**: All components should have proper type definitions
2. **Use i18n**: All user-facing strings should use `useTranslations`
3. **Error Handling**: Use `useErrorHandler` hook for consistent error handling
4. **Formatting**: Use centralized formatters from `@/lib/utils/formatters`
5. **Accessibility**: Include ARIA labels and keyboard navigation where appropriate
