'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { resolveSafeRouteErrorPresentation } from '@/lib/api/errors';

export default function UsageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  const errorPresentation = resolveSafeRouteErrorPresentation({ error, t });

  useEffect(() => {
    console.error('Usage page error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <AlertCircle className="h-12 w-12 text-error" />
      <h2 className="mt-4 text-lg font-medium text-text-strong">
        {t('error_title')}
      </h2>
      <p className="text-sm text-text-tertiary mt-2">
        {errorPresentation.description}
      </p>
      {errorPresentation.reference && (
        <p className="mt-2 text-xs text-text-tertiary font-mono">
          {t(errorPresentation.reference.labelKey)}: {errorPresentation.reference.value}
        </p>
      )}
      <Button onClick={reset} className="mt-4">
        {t('try_again')}
      </Button>
    </div>
  );
}
