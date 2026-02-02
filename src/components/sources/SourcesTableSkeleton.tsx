'use client';
import * as React from 'react';

export function SourcesTableSkeleton() {
  return (
    <div className="rounded-md overflow-hidden border border-border bg-surface">
      <table className="w-full border-collapse">
        <thead className="bg-transparent border-b border-subtle">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-tertiary w-12">
              <div className="w-4 h-4 bg-surface-high rounded animate-pulse" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-tertiary">
              <div className="h-4 w-32 bg-surface-high rounded animate-pulse" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-tertiary">
              <div className="h-4 w-20 bg-surface-high rounded animate-pulse" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-tertiary">
              <div className="h-4 w-24 bg-surface-high rounded animate-pulse" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-tertiary">
              <div className="h-4 w-28 bg-surface-high rounded animate-pulse" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-tertiary">
              <div className="h-4 w-20 bg-surface-high rounded animate-pulse" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-tertiary w-12">
              <div className="h-4 w-4 bg-surface-high rounded animate-pulse" />
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr
              key={i}
              className="border-b border-subtle last:border-b-0"
            >
              <td className="px-4 py-3">
                <div className="w-4 h-4 bg-surface-high rounded animate-pulse" />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-surface-high rounded-sm animate-pulse" />
                  <div className="flex-1">
                    <div className="h-4 w-48 bg-surface-high rounded animate-pulse mb-2" />
                    <div className="h-3 w-16 bg-surface-high rounded animate-pulse" />
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="h-4 w-16 bg-surface-high rounded animate-pulse" />
              </td>
              <td className="px-4 py-3">
                <div className="h-4 w-20 bg-surface-high rounded animate-pulse" />
              </td>
              <td className="px-4 py-3">
                <div className="h-6 w-24 bg-surface-high rounded-full animate-pulse" />
              </td>
              <td className="px-4 py-3">
                <div className="h-3 w-12 bg-surface-high rounded animate-pulse" />
              </td>
              <td className="px-4 py-3">
                <div className="w-8 h-8 bg-surface-high rounded animate-pulse" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
