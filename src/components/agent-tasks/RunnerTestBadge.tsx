'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type RunnerTestSourceMarker = {
  source?: 'runner_test';
  runner_test?: true | boolean;
} | null | undefined;

export function isRunnerTestSource(marker: RunnerTestSourceMarker): boolean {
  return marker?.source === 'runner_test' || marker?.runner_test === true;
}

export function RunnerTestBadge({
  label,
  title,
  className,
}: {
  label: string;
  title: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('border-accent/30 bg-accent/10 text-accent text-[11px]', className)}
      title={title}
      data-testid="agent-tasks__runner-test-badge"
    >
      {label}
    </Badge>
  );
}
