'use client';

import { AlertCircle } from 'lucide-react';

export function ImportantNotice({ t }: { t: (key: string) => string }) {
  return (
    <div className="rounded-md bg-surface-high border border-subtle p-3 flex items-start gap-2">
      <AlertCircle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
      <div className="text-xs text-tertiary space-y-1">
        <p className="font-medium text-foreground">{t('important')}</p>
        <p>• {t('agent_fixed_notice')}</p>
        <p>• {t('history_immutable_notice')}</p>
      </div>
    </div>
  );
}
