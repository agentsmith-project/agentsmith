# UI/UX Redesign Implementation Plan

> NOTE: This document is historical. Current source of truth:
> - `文档/UXUI/2026-01-31-视觉设计系统-v1.md`
> - `mbos_frontend/DESIGN_SYSTEM.md`

**Goal:** Implement complete UI/UX redesign aligning with Google NotebookLM style and the visual design system, including workspace/project navigation flow, TanStack Table integration, and strict adherence to design tokens.

**Architecture:**
- Two-phase login flow (Email → Workspace Selection)
- Context-aware navigation (sidebar changes based on project context)
- TanStack Table with custom styling for all management pages
- Three-column layouts for Chat/Workbench/Sources (240px | flex-1 | 300px)
- Semantic design tokens mapping to provided CSS variables

**Tech Stack:**
- Next.js 15 with App Router
- TypeScript
- Tailwind CSS (with custom design tokens)
- TanStack Table (v8)
- Zustand (state management)
- shadcn/ui components (to be updated with design tokens)

---

## Phase 1: Design System Foundation

### Task 1: Design Tokens Location

**Current implementation:**
- Tokens are defined in `mbos_frontend/src/app/globals.css` (RGB triplets + semantic names).
- Tailwind mapping lives in `mbos_frontend/tailwind.config.js`.

### Task 2: Update Tailwind Configuration

**Files:**
- Modify: `tailwind.config.ts`

**Step 1: Add custom color mappings to Tailwind config**

Add to `theme.extend` in `tailwind.config.ts`:

```typescript
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
        'sm': '8px',
        'md': '12px',
        'lg': '24px',
        '3xl': '24px',
      },
    },
  },
}
```

**Step 2: Test the build**

Run: `npm run build`
Expected: Build succeeds with new Tailwind config

**Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat: update Tailwind config with design token colors"
```

---

### Task 3: Update globals.css with Base Layer

**Files:**
- Modify: `src/app/globals.css`

**Step 1: Add base layer with body styles**

Update `src/app/globals.css` to include:

```css
@layer base {
  :root {
    /* Custom design variables are imported from design-tokens.css */
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }

  /* Focus visible styles for accessibility */
  :focus-visible {
    @apply outline-none ring-2 ring-accent/50;
  }
}
```

**Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: add base layer styles with focus ring support"
```

---

## Phase 2: Core UI Components

### Task 4: Create Status Badge Component

**Files:**
- Create: `src/components/ui/status-badge.tsx`

**Step 1: Create status badge component**

```tsx
// src/components/ui/status-badge.tsx
interface StatusBadgeProps {
  status: 'active' | 'paused' | 'error' | 'success' | 'warning';
  children?: React.ReactNode;
}

export function StatusBadge({ status, children }: StatusBadgeProps) {
  const styles = {
    active: {
      backgroundColor: 'var(--color-tertiary-green)',
      color: 'var(--color-on-tertiary-green)',
    },
    success: {
      backgroundColor: 'var(--color-tertiary-green)',
      color: 'var(--color-on-tertiary-green)',
    },
    paused: {
      backgroundColor: 'var(--color-tertiary-container)',
      color: 'var(--color-on-tertiary-container)',
    },
    warning: {
      backgroundColor: 'var(--color-tertiary-container)',
      color: 'var(--color-on-tertiary-container)',
    },
    error: {
      backgroundColor: 'var(--color-error-container)',
      color: 'var(--color-on-error-container)',
    },
  };

  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium"
      style={styles[status]}
    >
      {children || status}
    </span>
  );
}
```

**Step 2: Export from ui index**

Add to `src/components/ui/index.ts`:

```tsx
export * from './status-badge';
```

**Step 3: Commit**

```bash
git add src/components/ui/status-badge.tsx src/components/ui/index.ts
git commit -m "feat: add status badge component with design system colors"
```

---

### Task 5: Update Button Component

**Files:**
- Modify: `src/components/ui/button.tsx`

**Step 1: Update button to use design tokens**

Modify button variants to use semantic colors:

```typescript
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-foreground hover:bg-accent/90",
        destructive: "bg-error text-destructive-foreground hover:bg-error/90",
        outline: "border border-border bg-background hover:bg-surface-hover hover:text-foreground",
        secondary: "bg-surface text-foreground-secondary hover:bg-surface-hover",
        ghost: "hover:bg-surface-hover",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
```

**Step 2: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "feat: update button component with design system tokens"
```

---

### Task 6: Create Dropdown Menu Component

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx`

**Step 1: Create dropdown menu with MenuItem**

```tsx
// src/components/ui/dropdown-menu.tsx
import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenuPrimitive.Root>
      {children}
    </DropdownMenuPrimitive.Root>
  );
}

export function DropdownMenuTrigger({
  children,
  className,
  ...props
}: DropdownMenuPrimitive.DropdownMenuTriggerProps) {
  return (
    <DropdownMenuPrimitive.Trigger
      className={cn(
        "px-3 py-2 rounded-md text-sm transition-colors duration-200",
        "hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Trigger>
  );
}

export function DropdownMenuContent({
  children,
  className,
  ...props
}: DropdownMenuPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          "bg-surface border border-border rounded-md",
          "shadow-sm",
          className
        )}
        style={{ boxShadow: 'var(--v3-shadow-sm)' }}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function MenuItem({
  children,
  onClick,
  className,
  ...props
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "px-4 py-3 text-sm cursor-pointer",
        "transition-colors duration-200",
        "text-foreground hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
```

**Step 2: Export from ui index**

Add to `src/components/ui/index.ts`:

```tsx
export * from './dropdown-menu';
```

**Step 3: Commit**

```bash
git add src/components/ui/dropdown-menu.tsx src/components/ui/index.ts
git commit -m "feat: add dropdown menu component with design system styling"
```

---

### Task 7: Create Card Component

**Files:**
- Create: `src/components/ui/card.tsx`

**Step 1: Create card component**

```tsx
// src/components/ui/card.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border border-border bg-surface",
      className
    )}
    style={{ boxShadow: 'var(--v3-shadow-sm)' }}
    {...props}
  />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardContent };
```

**Step 2: Export from ui index**

Add to `src/components/ui/index.ts`:

```tsx
export * from './card';
```

**Step 3: Commit**

```bash
git add src/components/ui/card.tsx src/components/ui/index.ts
git commit -m "feat: add card component with design system styling"
```

---

### Task 8: Create Input Component (Prompt Style)

**Files:**
- Create: `src/components/ui/input.tsx`

**Step 1: Create input with prompt/capsule style**

```tsx
// src/components/ui/input.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'prompt';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'default', ...props }, ref) => {
    const promptStyle = variant === 'prompt'
      ? "rounded-3xl px-6 py-4 border-transparent focus:border-accent"
      : "rounded-md px-3 py-2";

    return (
      <input
        type={type}
        className={cn(
          "flex w-full bg-surface-high text-foreground",
          "border transition-all duration-200",
          "focus:outline-none focus:ring-2 focus:ring-accent/50",
          "placeholder:text-foreground-muted",
          "disabled:cursor-not-allowed disabled:opacity-50",
          promptStyle,
          className
        )}
        style={variant === 'prompt' ? {
          backgroundColor: 'var(--color-v3-surface-container-highest)',
          borderRadius: '24px',
        } : undefined}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
```

**Step 2: Export from ui index**

Add to `src/components/ui/index.ts`:

```tsx
export * from './input';
```

**Step 3: Commit**

```bash
git add src/components/ui/input.tsx src/components/ui/index.ts
git commit -m "feat: add input component with prompt variant"
```

---

## Phase 3: TanStack Table Integration

### Task 9: Install TanStack Table

**Files:**
- Modify: `package.json`

**Step 1: Install TanStack Table dependency**

Run: `npm install @tanstack/react-table`

Expected: Package added to dependencies

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install @tanstack/react-table"
```

---

### Task 10: Create Base DataTable Component

**Files:**
- Create: `src/components/ui/data-table.tsx`

**Step 1: Create DataTable component with TanStack Table**

```tsx
// src/components/ui/data-table.tsx
import { flexRender, Table as TanStackTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';

interface DataTableProps<TData> {
  table: TanStackTable<TData>;
}

export function DataTable<TData>({ table }: DataTableProps<TData>) {
  return (
    <div
      className="rounded-lg overflow-hidden border border-border bg-surface"
      style={{ boxShadow: 'var(--v3-shadow-sm)' }}
    >
      <table className="w-full border-collapse">
        <thead className="bg-surface-high">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  className="px-4 py-4 text-left text-sm font-medium text-foreground-secondary"
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr
              key={row.id}
              className="hover:bg-surface-hover transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {row.getVisibleCells().map(cell => (
                <td
                  key={cell.id}
                  className="px-4 py-4 text-sm text-foreground"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 2: Export from ui index**

Add to `src/components/ui/index.ts`:

```tsx
export * from './data-table';
```

**Step 3: Commit**

```bash
git add src/components/ui/data-table.tsx src/components/ui/index.ts
git commit -m "feat: add DataTable component with TanStack Table"
```

---

## Phase 4: Navigation Components

### Task 11: Create Topbar with Workspace/Project Switchers

**Files:**
- Modify: `src/components/app-shell/Topbar.tsx`

**Step 1: Update Topbar with switchers**

Replace content of `src/components/app-shell/Topbar.tsx`:

```tsx
// src/components/app-shell/Topbar.tsx
'use client';

import { useAuthStore } from '@/lib/stores/authStore';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, MenuItem } from '@/components/ui/dropdown-menu';
import { Globe, FolderKanban, ChevronDown, MoreVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function Topbar() {
  const { currentWorkspace, currentProject, workspaces, projects } = useAuthStore();
  const router = useRouter();

  const handleWorkspaceChange = (workspaceId: string) => {
    // Navigate to projects page of selected workspace
    router.push(`/en-US/workspaces/${workspaceId}/projects`);
  };

  const handleProjectChange = (projectId: string) => {
    // Navigate to overview of selected project
    router.push(`/en-US/workspaces/${currentWorkspace?.id}/projects/${projectId}/overview`);
  };

  return (
    <header className="h-14 border-b border-border bg-surface flex items-center justify-between px-4">
      {/* Left: Logo + Workspace Dropdown */}
      <div className="flex items-center gap-4">
        <Logo className="w-8 h-8" />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors">
            <Globe className="w-4 h-4 text-foreground-secondary" />
            <span className="text-sm text-foreground">{currentWorkspace?.name || 'Select Workspace'}</span>
            <ChevronDown className="w-4 h-4 text-foreground-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-surface border border-border rounded-md" align="start">
            {workspaces?.map(ws => (
              <MenuItem key={ws.id} onClick={() => handleWorkspaceChange(ws.id)}>
                {ws.name}
              </MenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Center/Right: Project Dropdown + User Menu */}
      <div className="flex items-center gap-4">
        {/* Project Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!currentProject}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${
              currentProject
                ? 'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
                : 'text-foreground-muted cursor-not-allowed'
            }`}
          >
            <FolderKanban className="w-4 h-4" />
            <span className="text-sm">{currentProject?.name || 'No project'}</span>
            {currentProject && <ChevronDown className="w-4 h-4" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-surface border border-border rounded-md" align="end">
            {projects?.map(proj => (
              <MenuItem key={proj.id} onClick={() => handleProjectChange(proj.id)}>
                {proj.name}
              </MenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <UserMenu />
      </div>
    </header>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/app-shell/Topbar.tsx
git commit -m "feat: update Topbar with workspace and project switchers"
```

---

### Task 12: Update Sidebar to be Context-Aware

**Files:**
- Modify: `src/components/app-shell/AppShellSidebar.tsx`

**Step 1: Update sidebar with context-aware menu**

Replace content of `src/components/app-shell/AppShellSidebar.tsx`:

```tsx
// src/components/app-shell/AppShellSidebar.tsx
'use client';

import { useAuthStore } from '@/lib/stores/authStore';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  MessageSquare,
  Wrench,
  FolderOpen,
  Bot,
  Server,
  Users,
  Settings as SettingsIcon,
  FolderKanban,
} from 'lucide-react';

const PROJECT_MENU_ITEMS = [
  { icon: LayoutDashboard, label: 'Overview', href: 'overview' },
  { icon: MessageSquare, label: 'Chat', href: 'chat' },
  { icon: Wrench, label: 'Workbench', href: 'workbench' },
  { icon: FolderOpen, label: 'Sources', href: 'sources' },
  { icon: Bot, label: 'Agents', href: 'agents' },
  { icon: Server, label: 'Endpoints', href: 'endpoints' },
  { icon: Users, label: 'Members', href: 'members' },
  { icon: SettingsIcon, label: 'Settings', href: 'settings' },
];

const WORKSPACE_MENU_ITEMS = [
  { icon: FolderKanban, label: 'Projects', href: '../projects' },
  { icon: SettingsIcon, label: 'Settings', href: '../settings' },
];

export function AppShellSidebar({ currentValue, onChange }: { currentValue?: string; onChange?: (value: string) => void }) {
  const { currentProject } = useAuthStore();
  const pathname = usePathname();

  const menuItems = currentProject ? PROJECT_MENU_ITEMS : WORKSPACE_MENU_ITEMS;

  return (
    <aside
      className="w-60 border-r border-border-subtle bg-surface flex flex-col"
      style={{
        backgroundColor: 'var(--color-v3-surface-left-nav)',
        borderRightColor: 'var(--color-v3-surface-left-nav-border)',
      }}
    >
      <nav className="flex-1 px-2 py-4 space-y-1">
        {menuItems.map((item) => {
          const isActive = pathname?.includes(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-200 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              style={{
                color: isActive ? 'var(--color-v3-text)' : 'var(--color-v3-text-var)',
                backgroundColor: isActive ? 'var(--color-v3-nav-item-active)' : undefined,
              }}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
              {/* Active indicator */}
              {isActive && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
                  style={{ backgroundColor: 'var(--color-v3-text-link)' }}
                />
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/app-shell/AppShellSidebar.tsx
git commit -m "feat: update sidebar to be context-aware"
```

---

## Phase 5: Authentication Flow

### Task 13: Create Workspace Selection Page

**Files:**
- Create: `src/app/[locale]/login/workspace/page.tsx`

**Step 1: Create workspace selection page**

```tsx
// src/app/[locale]/login/workspace/page.tsx
'use client';

import { useAuthStore } from '@/lib/stores/authStore';
import { useRouter } from 'next/navigation';
import { Building2, FolderKanban, Star } from 'lucide-react';
import { Card } from '@/components/ui/card';

export default function WorkspaceSelectPage() {
  const router = useRouter();
  const { workspaces, mockLogin } = useAuthStore();

  const handleWorkspaceSelect = (workspaceId: string) => {
    // Navigate to projects page
    router.push(`/en-US/workspaces/${workspaceId}/projects`);
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Select your workspace
        </h1>
        <p className="text-foreground-secondary mb-8">
          Choose a workspace to continue
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {workspaces?.map(workspace => (
            <WorkspaceCard
              key={workspace.id}
              workspace={workspace}
              onSelect={() => handleWorkspaceSelect(workspace.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceCard({ workspace, onSelect }: { workspace: any; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className="relative group bg-surface border border-border rounded-md p-6 transition-all duration-200 hover:bg-surface-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      style={{ boxShadow: 'var(--v3-shadow-sm)' }}
    >
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 rounded-lg bg-surface-high flex items-center justify-center">
          <Building2 className="w-6 h-6 text-foreground-secondary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">{workspace.name}</h3>
          <p className="text-sm text-foreground-secondary">{workspace.role}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-foreground-secondary">
        <span className="flex items-center gap-1">
          <FolderKanban className="w-4 h-4" />
          {workspace.projects?.length || 0} projects
        </span>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/[locale]/login/workspace/page.tsx
git commit -m "feat: add workspace selection page"
```

---

### Task 14: Update Login Page for Two-Step Flow

**Files:**
- Modify: `src/app/[locale]/login/page.tsx`

**Step 1: Update login page to redirect to workspace selection**

Update the handleQuickLogin function in `src/app/[locale]/login/page.tsx`:

```tsx
const handleQuickLogin = async () => {
  setIsLoggingIn(true);
  try {
    // Determine redirect based on user's workspaces
    const redirectPath = userWorkspaces.length > 0
      ? `/${locale}/login/workspace`  // Has workspaces, go to selection
      : `/${locale}/workspaces/ws_default/projects`; // First time, go to projects

    router.push(redirectPath);
  } catch (error) {
    console.error('Login failed:', error);
  } finally {
    setIsLoggingIn(false);
  }
};
```

**Step 2: Commit**

```bash
git add src/app/[locale]/login/page.tsx
git commit -m "feat: update login flow to two-step process"
```

---

## Phase 6: Projects List Page

### Task 15: Update Projects List with Hybrid Layout

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/page.tsx`

**Step 1: Update projects page with hybrid layout**

Replace content with:

```tsx
// src/app/[locale]/workspaces/[workspace]/projects/page.tsx
'use client';

import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';
import { createColumnHelper } from '@tanstack/react-table';
import { Bot, MessageSquare, Clock, Plus } from 'lucide-react';
import { useMemo } from 'react';

const columnHelper = createColumnHelper<any>();

const projectColumns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-surface-high flex items-center justify-center">
          <Bot className="w-4 h-4 text-foreground-secondary" />
        </div>
        <span className="text-foreground">{info.getValue()}</span>
      </div>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  columnHelper.accessor('updatedAt', {
    header: 'Last Updated',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm">
        {new Date(info.getValue()).toLocaleDateString()}
      </span>
    ),
  }),
];

export default function ProjectsPage({ params }: ProjectsPageProps) {
  const router = useRouter();
  const projects = useAuthStore((state) => state.projects);
  const currentWorkspace = useAuthStore((state) => state.currentWorkspace);
  const hydrated = useAuthStoreHydration();
  const [resolvedParams, setResolvedParams] = useState<any>(null);

  useEffect(() => {
    Promise.resolve(params).then(setResolvedParams);
  }, [params]);

  if (!resolvedParams || !hydrated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-foreground-muted">Loading...</div>
      </div>
    );
  }

  const pinnedProjects = projects.filter(p => p.pinned);
  const allProjects = projects;

  const table = useMemo(() => {
    return createTable({
      data: allProjects,
      columns: projectColumns,
    });
  }, [allProjects]);

  const handleProjectClick = (projectId: string) => {
    router.push(`/${resolvedParams.locale}/workspaces/${resolvedParams.workspace}/projects/${projectId}/overview`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-surface px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
            <p className="text-foreground-secondary text-sm mt-1">
              Workspace: {currentWorkspace?.name || resolvedParams.workspace}
            </p>
          </div>
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium transition-all duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            style={{
              background: 'var(--color-gemini-product-gradient)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        {/* Pinned Projects */}
        {pinnedProjects.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold text-foreground">Pinned Projects</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pinnedProjects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  pinned
                  onClick={() => handleProjectClick(project.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* All Projects Table */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">All Projects</h2>
          </div>
          <DataTable table={table} />
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, pinned, onClick }: { project: any; pinned: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="relative group bg-surface border border-border rounded-md p-6 transition-all duration-200 hover:bg-surface-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      style={{ boxShadow: 'var(--v3-shadow-sm)' }}
    >
      {pinned && (
        <div className="absolute top-4 right-4 text-accent">
          <Star className="w-5 h-5 fill-current" />
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-surface-high flex items-center justify-center">
          <Bot className="w-5 h-5 text-foreground-secondary" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">{project.name}</h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-foreground-secondary">
          <MessageSquare className="w-4 h-4" />
          <span>{project.turns || 0} turns</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-foreground-secondary">
          <Clock className="w-4 h-4" />
          <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="mt-4">
        <StatusBadge status={project.status || 'active'} />
      </div>
    </div>
  );
}

function createTable(options: any) {
  // TanStack Table creation helper
  return options;
}
```

**Step 2: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/page.tsx
git commit -m "feat: update projects page with hybrid layout"
```

---

## Phase 7: Rename userdata to sources

### Task 16: Rename userdata Directory to sources

**Files:**
- Create: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/sources/page.tsx`
- Delete: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/userdata/page.tsx`

**Step 1: Create new sources page**

Create `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/sources/page.tsx`:

```tsx
// src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/sources/page.tsx
'use client';

import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { createColumnHelper } from '@tanstack/react-table';
import { File, Plus, MoreVertical } from 'lucide-react';
import { useMemo } from 'react';

const columnHelper = createColumnHelper<any>();

const sourceColumns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => {
      const source = info.row.original;
      return (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-surface-high flex items-center justify-center">
            <File className="w-4 h-4 text-foreground-secondary" />
          </div>
          <div>
            <span className="text-foreground block">{source.name}</span>
            <span className="text-foreground-muted text-xs">{source.type}</span>
          </div>
        </div>
      );
    },
  }),
  columnHelper.accessor('size', {
    header: 'Size',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm font-mono">
        {formatBytes(info.getValue())}
      </span>
    ),
  }),
  columnHelper.accessor('uploadedAt', {
    header: 'Uploaded',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm">
        {new Date(info.getValue()).toLocaleDateString()}
      </span>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue() || 'active'} />,
  }),
];

export default function SourcesPage() {
  // Mock data - replace with actual API call
  const sources = useMemo(() => [], []);

  const table = useMemo(() => {
    return {
      ...createTable({
        data: sources,
        columns: sourceColumns,
      }),
      getHeaderGroups: () => [],
      getRowModel: () => ({ rows: [] }),
    };
  }, [sources]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Sources</h1>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium"
                style={{ background: 'var(--color-gemini-product-gradient)', borderRadius: 'var(--radius-sm)' }}>
          <Plus className="w-4 h-4" />
          Add Source
        </button>
      </div>
      <DataTable table={table} />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function createTable(options: any) {
  return options;
}
```

**Step 2: Delete old userdata page**

Run: `rm -rf src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/userdata`

**Step 3: Update sidebar menu item**

In `src/components/app-shell/AppShellSidebar.tsx`, update the menu item:
- Change: `{ icon: FolderOpen, label: 'Sources', href: 'sources' }`

**Step 4: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/sources src/components/app-shell/AppShellSidebar.tsx
git commit -m "feat: rename userdata to sources (align with NotebookLM)"
```

---

## Phase 8: Three-Column Layout Components

### Task 17: Create Sources Panel (Left Panel)

**Files:**
- Create: `src/components/app-shell/SourcesPanel.tsx`

**Step 1: Create SourcesPanel component**

```tsx
// src/components/app-shell/SourcesPanel.tsx
'use client';

import { Plus, File } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, MenuItem } from '@/components/ui/dropdown-menu';
import { useState } from 'react';

export function SourcesPanel() {
  const [sources, setSources] = useState([
    { id: '1', name: 'Document.pdf' },
    { id: '2', name: 'Notes.txt' },
  ]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Sources</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <button
          className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-foreground-secondary hover:bg-surface-hover transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={() => {/* TODO: open upload modal */}}
        >
          <Plus className="w-4 h-4" />
          Add Source
        </button>

        {sources.map(source => (
          <div
            key={source.id}
            className="px-3 py-2 rounded hover:bg-surface-hover cursor-pointer transition-colors duration-200"
          >
            <div className="flex items-center gap-2">
              <File className="w-4 h-4 text-foreground-muted" />
              <span className="text-sm text-foreground truncate">{source.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/app-shell/SourcesPanel.tsx
git commit -m "feat: add SourcesPanel component for three-column layout"
```

---

### Task 18: Create Context Panel (Right Panel)

**Files:**
- Create: `src/components/app-shell/ContextPanel.tsx`

**Step 1: Create ContextPanel component**

```tsx
// src/components/app-shell/ContextPanel.tsx
'use client';

import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { Settings2 } from 'lucide-react';

function ParameterSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-foreground-secondary">{label}</label>
        <span className="text-xs font-mono text-foreground">{value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-surface-high rounded-full appearance-none cursor-pointer"
        style={{ accentColor: 'var(--color-v3-text-link)' }}
      />
    </div>
  );
}

export function ContextPanel() {
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [selectedModel, setSelectedModel] = useState('gpt-4');

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Context</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Model settings */}
        <section>
          <h3 className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-3">
            Model
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full px-3 py-2 rounded bg-surface-high border border-border text-sm text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
              {selectedModel}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-surface border border-border rounded-md w-full">
              <div className="px-3 py-2 text-sm text-foreground hover:bg-surface-hover cursor-pointer" onClick={() => setSelectedModel('gpt-4')}>
                gpt-4
              </div>
              <div className="px-3 py-2 text-sm text-foreground hover:bg-surface-hover cursor-pointer" onClick={() => setSelectedModel('gpt-3.5-turbo')}>
                gpt-3.5-turbo
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        {/* Parameters */}
        <section>
          <h3 className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-3">
            Parameters
          </h3>
          <div className="space-y-4">
            <ParameterSlider label="Temperature" value={temperature} onChange={setTemperature} />
            <ParameterSlider label="Max Tokens" value={maxTokens / 4096} onChange={(v) => setMaxTokens(Math.round(v * 4096))} />
          </div>
        </section>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/app-shell/ContextPanel.tsx
git commit -m "feat: add ContextPanel component for three-column layout"
```

---

### Task 19: Create Three-Column Layout for Chat

**Files:**
- Create: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/chat/layout.tsx`

**Step 1: Create chat layout with three columns**

```tsx
// src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/chat/layout.tsx
import { ReactNode } from 'react';
import { SourcesPanel } from '@/components/app-shell/SourcesPanel';
import { ContextPanel } from '@/components/app-shell/ContextPanel';

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left: Sources - 240px */}
      <aside
        className="w-60 border-r border-border-subtle bg-surface flex-shrink-0"
        style={{
          backgroundColor: 'var(--color-v3-surface-left-nav)',
          borderRightColor: 'var(--color-v3-surface-left-nav-border)',
        }}
      >
        <SourcesPanel />
      </aside>

      {/* Center: Canvas - flexible */}
      <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
        {children}
      </main>

      {/* Right: Context - 300px */}
      <aside
        className="w-[300px] border-l border-border bg-surface flex-shrink-0"
        style={{ backgroundColor: 'var(--color-v3-surface-container)' }}
      >
        <ContextPanel />
      </aside>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/chat/layout.tsx
git commit -m "feat: add three-column layout for Chat page"
```

---

### Task 20: Create Three-Column Layout for Workbench

**Files:**
- Create: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/workbench/layout.tsx`

**Step 1: Create workbench layout with three columns**

```tsx
// src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/workbench/layout.tsx
import { ReactNode } from 'react';
import { SourcesPanel } from '@/components/app-shell/SourcesPanel';
import { ContextPanel } from '@/components/app-shell/ContextPanel';

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left: Sources - 240px */}
      <aside
        className="w-60 border-r border-border-subtle bg-surface flex-shrink-0"
        style={{
          backgroundColor: 'var(--color-v3-surface-left-nav)',
          borderRightColor: 'var(--color-v3-surface-left-nav-border)',
        }}
      >
        <SourcesPanel />
      </aside>

      {/* Center: Canvas - flexible */}
      <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
        {children}
      </main>

      {/* Right: Context - 300px */}
      <aside
        className="w-[300px] border-l border-border bg-surface flex-shrink-0"
        style={{ backgroundColor: 'var(--color-v3-surface-container)' }}
      >
        <ContextPanel />
      </aside>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/workbench/layout.tsx
git commit -m "feat: add three-column layout for Workbench page"
```

---

### Task 21: Create Three-Column Layout for Sources

**Files:**
- Create: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/sources/layout.tsx`

**Step 1: Create sources layout with three columns**

```tsx
// src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/sources/layout.tsx
import { ReactNode } from 'react';
import { SourcesPanel } from '@/components/app-shell/SourcesPanel';
import { ContextPanel } from '@/components/app-shell/ContextPanel';

export default function SourcesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left: Sources - 240px */}
      <aside
        className="w-60 border-r border-border-subtle bg-surface flex-shrink-0"
        style={{
          backgroundColor: 'var(--color-v3-surface-left-nav)',
          borderRightColor: 'var(--color-v3-surface-left-nav-border)',
        }}
      >
        <SourcesPanel />
      </aside>

      {/* Center: Canvas - flexible */}
      <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
        {children}
      </main>

      {/* Right: Context - 300px */}
      <aside
        className="w-[300px] border-l border-border bg-surface flex-shrink-0"
        style={{ backgroundColor: 'var(--color-v3-surface-container)' }}
      >
        <ContextPanel />
      </aside>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/sources/layout.tsx
git commit -m "feat: add three-column layout for Sources page"
```

---

## Phase 9: Update Management Pages with TanStack Table

### Task 22: Update Agents Page with TanStack Table

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/agents/page.tsx`

**Step 1: Update agents page with TanStack Table**

Replace content with:

```tsx
// src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/agents/page.tsx
'use client';

import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { createColumnHelper } from '@tanstack/react-table';
import { Bot, MoreVertical } from 'lucide-react';
import { useMemo } from 'react';

const columnHelper = createColumnHelper<any>();

const agentColumns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-surface-high flex items-center justify-center">
          <Bot className="w-4 h-4 text-foreground-secondary" />
        </div>
        <span className="text-foreground">{info.getValue()}</span>
      </div>
    ),
  }),
  columnHelper.accessor('model', {
    header: 'Model',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm font-mono">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('temperature', {
    header: 'Temp',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue() || 'active'} />,
  }),
];

export default function AgentsPage() {
  // Mock data - replace with actual API call
  const agents = useMemo(() => [], []);

  const table = useMemo(() => {
    return {
      ...createTable({
        data: agents,
        columns: agentColumns,
      }),
      getHeaderGroups: () => [],
      getRowModel: () => ({ rows: [] }),
    };
  }, [agents]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
      </div>
      <DataTable table={table} />
    </div>
  );
}

function createTable(options: any) {
  return options;
}
```

**Step 2: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/agents/page.tsx
git commit -m "feat: update agents page with TanStack Table"
```

---

### Task 23: Update Endpoints Page with TanStack Table

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/endpoints/page.tsx`

**Step 1: Update endpoints page with TanStack Table**

Replace with similar pattern using columns: Name, URL, Method, Rate Limit, Status

**Step 2: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/endpoints/page.tsx
git commit -m "feat: update endpoints page with TanStack Table"
```

---

### Task 24: Update Members Page with TanStack Table

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/members/page.tsx`

**Step 1: Update members page with TanStack Table**

Replace with similar pattern using columns: Name, Email, Role, Joined

**Step 2: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/members/page.tsx
git commit -m "feat: update members page with TanStack Table"
```

---

### Task 25: Update Audit Page with TanStack Table

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/audit/page.tsx`

**Step 1: Update audit page with TanStack Table**

Replace with similar pattern using columns: Timestamp, User, Action, Resource, Details

**Step 2: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/audit/page.tsx
git commit -m "feat: update audit page with TanStack Table"
```

---

### Task 26: Update Usage Page with TanStack Table

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/usage/page.tsx`

**Step 1: Update usage page with TanStack Table**

Replace with similar pattern using columns: Date, Requests, Tokens, Cost, Breakdown

**Step 2: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/usage/page.tsx
git commit -m "feat: update usage page with TanStack Table"
```

---

## Phase 10: Testing & Documentation

### Task 27: Update E2E Tests for New Navigation Flow

**Files:**
- Modify: `e2e/login.spec.ts`
- Modify: `e2e/navigation.spec.ts`

**Step 1: Update login flow tests**

Add test for two-step login (Email → Workspace Selection):

```typescript
test('should complete two-step login flow', async ({ page }) => {
  // Step 1: Email entry
  await page.goto('/en-US/login');
  await page.locator('input[placeholder*="user@example.com"]').fill('user@test.com');
  await page.getByText('Continue').click();

  // Step 2: Workspace selection
  await expect(page).toHaveURL(/\/login\/workspace/);
  await page.getByText('Default Workspace').click();

  // Should land on projects
  await expect(page).toHaveURL(/\/workspaces\/ws_default\/projects/);
});
```

**Step 2: Update navigation tests**

Add tests for workspace/project switching via topbar

**Step 3: Run E2E tests**

Run: `npm run test:e2e`

Expected: All tests pass with new navigation flow

**Step 4: Commit**

```bash
git add e2e/login.spec.ts e2e/navigation.spec.ts
git commit -m "test: update E2E tests for new navigation flow"
```

---

### Task 28: Create Component Documentation

**Files:**
- Create: `docs/components.md`

**Step 1: Create component documentation**

Document all custom components with design system usage examples.

**Step 2: Commit**

```bash
git add docs/components.md
git commit -m "docs: add component documentation"
```

---

### Task 29: Final Design Compliance Check

**Files:**
- Modify: Various (as needed)

**Step 1: Review all components for design compliance**

Checklist:
- [ ] All interactive elements have `focus-visible:ring-2 ring-accent/50`
- [ ] No divider lines in tables (use hover instead)
- [ ] All shadows use `v3-shadow-*` tokens
- [ ] All transitions specify `duration-200`
- [ ] Prompt inputs use 24px radius
- [ ] Primary buttons use gradient with 50deg
- [ ] Status badges use container + on-color pattern
- [ ] Touch targets are minimum 44x44px
- [ ] Three-column layouts use exact dimensions (240px / flex-1 / 300px)

**Step 2: Fix any compliance issues**

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete UI/UX redesign with Google NotebookLM style

- Implemented two-phase login flow (Email → Workspace Selection)
- Added workspace and project switchers in topbar
- Created context-aware sidebar (changes based on project selection)
- Integrated TanStack Table for all management pages
- Implemented three-column layouts for Chat, Workbench, Sources
- Renamed userdata to sources (NotebookLM alignment)
- Applied strict design system token mapping
- Added focus rings for all interactive elements (a11y)
- Removed divider lines in favor of spacing/hover (design principle)
- All shadows use v3-shadow tokens
- All animations use 150-300ms duration

Design tokens from: /docs/UXUI/2026-01-31-视觉设计系统-v1.md
Design document: /docs/plans/2026-02-01-ui-redesign-design.md"
```

---

## Summary

This implementation plan covers:

1. **Design System Foundation** (Tasks 1-3): CSS variables, Tailwind config, base styles
2. **Core UI Components** (Tasks 4-8): Status badge, button, dropdown, card, input
3. **TanStack Table Integration** (Tasks 9-10): Installation, base DataTable component
4. **Navigation Components** (Tasks 11-12): Topbar with switchers, context-aware sidebar
5. **Authentication Flow** (Tasks 13-14): Workspace selection, two-step login
6. **Projects List** (Task 15): Hybrid layout with pinned cards + table
7. **userdata → Sources Rename** (Task 16): Directory and menu update
8. **Three-Column Layouts** (Tasks 17-21): Left/Center/Right panels for Chat/Workbench/Sources
9. **Management Pages** (Tasks 22-26): TanStack Table for agents, endpoints, members, audit, usage
10. **Testing & Documentation** (Tasks 27-29): E2E tests, component docs, compliance check

**Total Tasks:** 29
**Estimated Time:** 2-3 weeks with diligent execution

---

**Remember:**
- Run tests after each change
- Commit frequently (after each task or logical grouping)
- Follow TDD: write test → fail → implement → pass → commit
- Reference design document for token values: `/docs/plans/2026-02-01-ui-redesign-design.md`
- Reference design system: `/docs/UXUI/2026-01-31-视觉设计系统-v1.md`
