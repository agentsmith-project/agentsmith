'use client';

import Link from 'next/link';

import type { OverviewLinkItem } from '../overview-page-utils';

interface OverviewLinkSectionProps {
  items: OverviewLinkItem[];
  testId: string;
  title: string;
}

export function OverviewLinkSection({
  items,
  testId,
  title,
}: OverviewLinkSectionProps) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            className="group rounded-[18px] border border-white/6 bg-white/[0.03] px-4 py-4 text-sm text-foreground transition-all hover:-translate-y-0.5 hover:border-accent/20 hover:bg-white/[0.05] hover:shadow-[0_14px_30px_rgba(0,0,0,0.16)]"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">Open</div>
            <div className="mt-2 font-medium text-foreground transition-colors group-hover:text-white">{item.label}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
