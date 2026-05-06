'use client';

import type { ReactNode } from 'react';

interface AgentRunnerSectionProps {
  title: string;
  description: string;
  count: number;
  testId: string;
  emptyLabel: string;
  children?: ReactNode;
}

export function AgentRunnerSection({
  title,
  description,
  count,
  testId,
  emptyLabel,
  children,
}: AgentRunnerSectionProps) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-tertiary">{description}</p>
        </div>
        <div className="w-fit rounded-full border border-subtle bg-surface-low px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
          {count}
        </div>
      </div>
      {count > 0 ? children : (
        <div className="rounded-md border border-dashed border-subtle bg-surface/80 px-4 py-6 text-sm text-tertiary">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}
