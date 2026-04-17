import type { ReactNode } from 'react';

export function PreviewRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-tertiary">{label}</span>
      <div className="break-all text-right text-foreground">{value}</div>
    </div>
  );
}
