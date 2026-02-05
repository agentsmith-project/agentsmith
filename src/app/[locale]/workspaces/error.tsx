'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { Link } from '@/lib/i18n/routing';

/**
 * Error Boundary for workspace-level errors.
 * Catches errors in workspace listing and navigation.
 */
export default function WorkspacesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  const tc = useTranslations('common');

  useEffect(() => {
    console.error('Workspaces error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8">
      <div className="flex flex-col items-center text-center max-w-md">
        <div className="rounded-full bg-error/10 p-4">
          <AlertCircle className="h-10 w-10 text-error" />
        </div>
        <h2 className="mt-4 text-lg font-medium text-text-strong">
          {t('error_title')}
        </h2>
        <p className="mt-2 text-sm text-text-tertiary">
          {error.message || t('error_message')}
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-text-tertiary font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <Button onClick={reset} variant="default">
            <RefreshCw className="mr-2 h-4 w-4" />
            {tc('try_again')}
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" />
              {tc('go_home')}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
