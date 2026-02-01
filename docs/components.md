# MBOS Frontend Components

This document describes the custom UI components used in the MBOS frontend application.

## Design System Colors

All components use semantic design tokens defined in `src/app/globals.css`:
- **Surfaces**: `--background`, `--surface`, `--surface-high`, `--surface-hover`
- **Text**: `--foreground`, `--foreground-secondary`, `--foreground-muted`
- **Border**: `--border`, `--border-subtle`
- **Accent**: `--accent`
- **Semantic**: `--success`, `--warning`, `--error`

## Core UI Components

### Button (`src/components/ui/button.tsx`)

Variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`

Sizes: `default`, `sm`, `lg`, `icon`

```tsx
import { Button } from '@/components/ui/button';

<Button variant="default">Click me</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline" size="sm">Small</Button>
```

### StatusBadge (`src/components/ui/status-badge.tsx`)

Displays status with colored background.

Status types: `active`, `paused`, `error`, `success`, `warning`

```tsx
import { StatusBadge } from '@/components/ui/status-badge';

<StatusBadge status="active">Active</StatusBadge>
<StatusBadge status="error">Failed</StatusBadge>
```

### DataTable (`src/components/ui/data-table.tsx`)

Table component using TanStack Table with design system styling.

```tsx
import { DataTable } from '@/components/ui/data-table';
import { createColumnHelper } from '@tanstack/react-table';

const columnHelper = createColumnHelper<DataType>();
const columns = [
  columnHelper.accessor('name', { header: 'Name' }),
  // ...
];

const table = useReactTable({ data, columns });
<DataTable table={table} />
```

### Input (`src/components/ui/input.tsx`)

Input field with optional prompt variant.

Variants: `default`, `prompt`

```tsx
import { Input } from '@/components/ui/input';

<Input placeholder="Enter text..." />
<Input variant="prompt" placeholder="Type a message..." />
```

### Card (`src/components/ui/card.tsx`)

Container component with header, title, and content sub-components.

```tsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>Content goes here</CardContent>
</Card>
```

### DropdownMenu (`src/components/ui/dropdown-menu.tsx`)

Dropdown menu using Radix UI primitives.

```tsx
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, MenuItem } from '@/components/ui/dropdown-menu';

<DropdownMenu>
  <DropdownMenuTrigger>Open</DropdownMenuTrigger>
  <DropdownMenuContent>
    <MenuItem onClick={handleAction}>Action</MenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

## Layout Components

### Topbar (`src/components/app-shell/Topbar.tsx`)

Top navigation bar with workspace and project switchers.

### AppShellSidebar (`src/components/app-shell/AppShellSidebar.tsx`)

Context-aware sidebar that changes based on project selection.

### SourcesPanel (`src/components/app-shell/SourcesPanel.tsx`)

Left panel for three-column layouts, displays sources list.

### ContextPanel (`src/components/app-shell/ContextPanel.tsx`)

Right panel for three-column layouts, displays model settings and parameters.

## Accessibility

All interactive components include:
- `focus-visible:ring-2 focus-visible:ring-accent/50` for keyboard navigation
- Proper disabled states
- Semantic HTML elements

## Design Principles

1. **No divider lines**: Tables and lists use hover states (`hover:bg-surface-hover`) instead of dividers
2. **Weak shadows**: Use `shadow-sm` class only
3. **Consistent transitions**: All animations use `duration-200`
4. **Focus rings**: All interactive elements have `ring-accent/50` focus-visible states
