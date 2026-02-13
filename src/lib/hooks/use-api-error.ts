/**
 * Standardized API Error Handling Hook
 *
 * Provides consistent error handling across all components:
 * - Displays toast notifications for errors
 * - Manages error state
 * - Supports retry actions
 * - Formats error messages with context
 * - i18n support for user-friendly messages
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { handleError, error, clearError } = useApiError();
 *
 *   const mutation = useMutation({
 *     onSuccess: () => toast.success('Success'),
 *     onError: (err) => handleError(err, { context: 'Creating user' })
 *   });
 *
 *   return (
 *     <>
 *       {error && <ErrorDisplay error={error} onDismiss={clearError} />}
 *       <Button onClick={() => mutation.mutate()}>Submit</Button>
 *     </>
 *   );
 * }
 * ```
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { APIError, resolveApiErrorPresentation } from '@/lib/api/errors';
import { toast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';

export interface ApiErrorOptions {
  context?: string;
  onRetry?: () => void;
  fallbackMessage?: string;
}

export interface UseApiErrorReturn {
  error: Error | null;
  isVisible: boolean;
  handleError: (error: unknown, options?: ApiErrorOptions) => void;
  clearError: () => void;
  retry: () => void;
  setError: (error: Error | null) => void;
}

export function useApiError(): UseApiErrorReturn {
  const [error, setError] = useState<Error | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const retryCallbackRef = useRef<(() => void) | null>(null);
  const t = useTranslations('errors');

  const handleError = useCallback(
    (err: unknown, options: ApiErrorOptions = {}) => {
      const { context, onRetry, fallbackMessage } = options;

      let errorObj: Error;
      let title: string;
      let description: string;

      if (err instanceof APIError) {
        errorObj = err;
        const resolved = resolveApiErrorPresentation({
          error: err,
          t,
          context,
          fallbackMessage,
        });
        title = resolved.title;
        description = resolved.description;
      } else if (err instanceof TypeError && err.message.includes('fetch')) {
        // Network error
        errorObj = new Error('Network error');
        title = t('networkError.title');
        description = t('networkError.description');
      } else if (err instanceof Error) {
        errorObj = err;
        title = t('unknown.title');
        description = err.message || fallbackMessage || t('unknown.description');
      } else {
        errorObj = new Error('Unknown error');
        title = t('unknown.title');
        description = fallbackMessage || t('unknown.description');
      }

      // Add context to description if provided
      if (context && !description.includes(context)) {
        description = `${context}: ${description}`;
      }

      setError(errorObj);
      setIsVisible(true);
      retryCallbackRef.current = onRetry || null;

      // Show toast notification
      toast.error(`${title}: ${description}`);
    },
    [t]
  );

  const clearError = useCallback(() => {
    setError(null);
    setIsVisible(false);
    retryCallbackRef.current = null;
  }, []);

  const retry = useCallback(() => {
    const callback = retryCallbackRef.current;
    if (callback) {
      callback();
      clearError();
    }
  }, [clearError]);

  return {
    error,
    isVisible,
    handleError,
    clearError,
    retry,
    setError,
  };
}
