'use client';
import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PermissionItem } from './PermissionItem';
import { cn } from '@/lib/utils';

export interface PermissionGroupProps {
  id: string;
  name: string;
  permissions: readonly string[];
  selectedPermissions: Set<string>;
  onPermissionToggle: (permission: string, checked: boolean) => void;
  descriptions?: Record<string, string>;
}

export function PermissionGroup({
  id,
  name,
  permissions,
  selectedPermissions,
  onPermissionToggle,
  descriptions,
}: PermissionGroupProps) {
  const [expanded, setExpanded] = React.useState(true);
  const selectedCount = permissions.filter((p) => selectedPermissions.has(p)).length;

  return (
    <div className="border border-border rounded-md bg-surface">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-tertiary" />
          ) : (
            <ChevronRight className="h-4 w-4 text-tertiary" />
          )}
          <span className="text-sm font-medium text-foreground">{name}</span>
          <span className="text-xs text-tertiary">
            ({selectedCount}/{permissions.length})
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {permissions.map((permission) => (
            <PermissionItem
              key={permission}
              permission={permission}
              checked={selectedPermissions.has(permission)}
              onToggle={onPermissionToggle}
              description={descriptions?.[permission]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
