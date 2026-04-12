'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface EndpointDialogFooterProps {
  canSubmit: boolean;
  createPending: boolean;
  hasCredentials: boolean;
  commonT: (key: string) => string;
  onCancel: () => void;
}

export function EndpointDialogFooter({
  canSubmit,
  createPending,
  hasCredentials,
  commonT,
  onCancel,
}: EndpointDialogFooterProps) {
  return (
    <div className="flex flex-shrink-0 flex-col-reverse gap-2 border-t border-subtle px-6 py-4 sm:flex-row sm:justify-end" data-testid="endpoints__dialog-footer">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={createPending} className="w-full sm:w-auto">
        {commonT('cancel')}
      </Button>
      <Button
        type="submit"
        variant="primary"
        disabled={!canSubmit || !hasCredentials || createPending}
        className="w-full sm:w-auto"
        aria-label={commonT('create')}
      >
        {createPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="sr-only">{commonT('create')}</span>
          </>
        ) : commonT('create')}
      </Button>
    </div>
  );
}
