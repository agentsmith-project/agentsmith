/**
 * Error State Components
 *
 * Consistent error display across the application.
 */

import { AlertCircle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, retryLabel = 'Try Again' }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8">
      <AlertCircle className="w-16 h-16 text-error mb-4" />
      <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
      <p className="text-tertiary mb-6 max-w-md">{message}</p>
      {onRetry && (
        <Button variant="action" onClick={onRetry}>
          <RefreshCw className="w-4 h-4" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

interface ErrorCardProps {
  message: string;
  onDismiss?: () => void;
}

export function ErrorCard({ message, onDismiss }: ErrorCardProps) {
  useEffect(() => {
    if (onDismiss) {
      const timer = setTimeout(onDismiss, 5000);
      return () => clearTimeout(timer);
    }
  }, [onDismiss]);

  return (
    <div className="flex items-start gap-3 p-4 rounded-md border border-subtle bg-surface-high border-l-2 border-l-error/70">
      <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm text-primary">{message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-tertiary hover:text-foreground transition-colors"
        >
          ×
        </button>
      )}
    </div>
  );
}
