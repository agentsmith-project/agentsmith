import { APIError, resolveApiErrorPresentation } from '@/lib/api/errors';

type ErrorTranslator = (key: string, values?: Record<string, string | number>) => string;

export function getOperationErrorDetail(
  error: unknown,
  tErrors: ErrorTranslator,
  fallbackMessage: string,
): string {
  if (error instanceof APIError) {
    const resolved = resolveApiErrorPresentation({
      error,
      t: tErrors,
      fallbackMessage,
    });
    return resolved.description;
  }
  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }
  return fallbackMessage;
}
