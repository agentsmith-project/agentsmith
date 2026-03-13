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
            className="rounded-sm border border-subtle px-3 py-2 text-sm text-foreground transition-colors hover:bg-hover"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
