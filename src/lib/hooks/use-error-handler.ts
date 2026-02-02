/**
 * Unified Error Handler Hook
 * 
 * Provides consistent error handling across the application.
 * Handles ApiError, Error, and unknown error types with i18n support.
 */

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/client';
import { formatErrorForToast } from '@/lib/api/errors';

export interface ErrorHandlerOptions {
  showToast?: boolean;
  logContext?: string;
  fallbackMessage?: string;
}

export function useErrorHandler() {
  const t = useTranslations('errors');

  const handleError = useCallback(
    (
      error: unknown,
      options?: ErrorHandlerOptions
    ): { errorCode?: string; message: string; requestId?: string } => {
      const {
        showToast = true,
        logContext,
        fallbackMessage,
      } = options || {};

      let errorInfo: {
        errorCode?: string;
        message: string;
        requestId?: string;
      };

      if (error instanceof ApiError) {
        errorInfo = {
          errorCode: error.errorCode,
          message: formatErrorForToast(error) || error.message,
          requestId: error.requestId,
        };
      } else if (error instanceof Error) {
        errorInfo = {
          message: error.message || fallbackMessage || t('unknown_error'),
        };
      } else {
        errorInfo = {
          message: fallbackMessage || t('unknown_error'),
        };
      }

      // Log error
      if (logContext) {
        console.error(`[${logContext}]`, error);
      }

      // Show toast
      if (showToast) {
        toast.error(errorInfo.message);
      }

      return errorInfo;
    },
    [t]
  );

  return { handleError };
}
