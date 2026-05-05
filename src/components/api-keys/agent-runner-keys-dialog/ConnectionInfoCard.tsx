'use client';

import { Copy, Link2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ConnectionInfoCardProps {
  copied: boolean;
  copyLabel: string;
  title: string;
  wsUrl?: string | null;
  onCopy: () => void;
}

export function ConnectionInfoCard({
  copied: _copied,
  copyLabel,
  title,
  wsUrl,
  onCopy,
}: ConnectionInfoCardProps) {
  return (
    <div
      className="w-full max-w-full overflow-hidden rounded-lg border border-subtle bg-surface-high/25 p-4"
      data-testid="agent-runners__connection-info-card"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-tertiary">
          <Link2 className="h-3.5 w-3.5" />
          {title}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCopy}
          disabled={!wsUrl}
          className="h-7 shrink-0 px-2.5 text-xs"
          data-testid="agent-runners__connection-info-copy-ws-url"
        >
          <Copy className="mr-1 h-3.5 w-3.5" />
          {copyLabel}
        </Button>
      </div>
      <div className="rounded-md border border-subtle bg-surface px-3 py-2.5">
        <code
          className="block max-h-24 overflow-auto break-all text-xs leading-relaxed text-primary"
          data-testid="agent-runners__connection-info-ws-url"
        >
          {wsUrl || '—'}
        </code>
      </div>
    </div>
  );
}
