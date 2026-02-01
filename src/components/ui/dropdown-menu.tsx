'use client';
import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export function DropdownMenu({
  children,
  modal = false,
}: {
  children: React.ReactNode;
  /**
   * Default `false` to avoid scroll-lock/body padding adjustments that can
   * cause subtle layout shift (e.g. topbar width changes) when menus open.
   */
  modal?: boolean;
}) {
  return <DropdownMenuPrimitive.Root modal={modal}>{children}</DropdownMenuPrimitive.Root>;
}

export function DropdownMenuTrigger({
  children,
  className,
  asChild,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      className={cn(
        asChild
          ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50"
          : [
              "px-3 py-2 rounded-sm text-sm transition-colors duration-200",
              "text-primary hover:bg-hover hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
              "disabled:pointer-events-none disabled:opacity-50",
            ],
        className
      )}
      asChild={asChild}
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
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          "min-w-[12rem] overflow-hidden rounded-md border border-subtle bg-surface-high shadow-float",
          className
        )}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 px-3 py-2 text-sm outline-none",
        "transition-colors duration-200",
        "text-primary hover:bg-hover hover:text-foreground",
        "focus:bg-hover focus:text-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("my-1 h-px bg-subtle", className)}
      {...props}
    />
  );
}
