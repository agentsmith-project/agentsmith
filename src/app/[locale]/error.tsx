'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { Link } from '@/lib/i18n/routing';

/**
 * Global Error Boundary for locale-level errors.
 * Catches errors from layout components and nested routes that don't have their own error boundary.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  const tc = useTranslations('common');

  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-base p-8">
      <div className="flex flex-col items-center text-center max-w-md">
        <div className="rounded-full bg-error/10 p-4">
          <AlertCircle className="h-12 w-12 text-error" />
        </div>
        <h1 className="mt-6 text-xl font-semibold text-text-strong">
          {t('error_title')}
        </h1>
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
