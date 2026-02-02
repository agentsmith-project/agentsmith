'use client';
import * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AlertTriangle } from 'lucide-react';
import { isHighRiskPermission } from '@/lib/constants/permissions';
import { cn } from '@/lib/utils';

export interface PermissionItemProps {
  permission: string;
  checked: boolean;
  onToggle: (permission: string, checked: boolean) => void;
  description?: string;
}

export function PermissionItem({
  permission,
  checked,
  onToggle,
  description,
}: PermissionItemProps) {
  const isHighRisk = isHighRiskPermission(permission);

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-sm hover:bg-hover transition-colors">
      <Checkbox
        id={permission}
        checked={checked}
        onCheckedChange={(checked) => onToggle(permission, checked as boolean)}
        className="shrink-0"
      />
      <label
        htmlFor={permission}
        className="flex-1 flex items-center gap-2 cursor-pointer text-sm text-foreground"
      >
        <code className="text-xs font-mono text-primary">{permission}</code>
        {isHighRisk && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  High Risk
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  This permission has significant impact and requires careful consideration.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {description && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-tertiary text-xs">(?)</span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </label>
    </div>
  );
}
