'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function AgentTasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');

  useEffect(() => {
    console.error('Agent tasks page error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <AlertCircle className="h-12 w-12 text-error" />
      <h2 className="mt-4 text-lg font-medium text-text-strong">
        {t('error_title')}
      </h2>
      <p className="text-sm text-text-tertiary mt-2">
        {error.message || t('error_message')}
      </p>
      <Button onClick={reset} className="mt-4">
        {t('try_again')}
      </Button>
    </div>
  );
}
