/**
 * Unit tests for use-api-error hook
 *
 * Tests for standardized API error handling including:
 * - APIError handling with toast notifications
 * - Network error handling
 * - Error state management
 * - Clear error functionality
 * - Retry action support
 * - i18n error messages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApiError } from '../use-api-error';
import { APIError } from '@/lib/api/errors';
import * as toastModule from '@/components/ui/toast';
import * as React from 'react';

// Mock toast - create mock inside factory to avoid hoisting issues
vi.mock('@/components/ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}));

// The global setup.ts already mocks next-intl, but we override for specific translations
vi.mock('next-intl', () => ({
  useTranslations: (_namespace: string) => (key: string) => {
    // The hook uses useTranslations('errors'), so key will be like 'badRequest.title'
    const translations: Record<string, string> = {
      'badRequest.title': 'Invalid Request',
      'badRequest.description': 'Please check your input and try again.',
      'unauthorized.title': 'Authentication Required',
      'unauthorized.description': 'Please log in to continue.',
      'forbidden.title': 'Access Denied',
      'forbidden.description': "You don't have permission to perform this action.",
      'notFound.title': 'Not Found',
      'notFound.description': 'The requested resource was not found.',
      'notFound.withContext': '%context% not found',
      'conflict.title': 'Conflict',
      'conflict.description': 'This action conflicts with existing data.',
      'rateLimit.title': 'Too Many Requests',
      'rateLimit.description': 'Please wait a moment before trying again.',
      'serverError.title': 'Server Error',
      'serverError.description': 'Something went wrong. Please try again later.',
      'networkError.title': 'Network Error',
      'networkError.description': 'Please check your connection and try again.',
      'unknown.title': 'Error',
      'unknown.description': 'An unexpected error occurred.',
    };
    return translations[key] || key;
  },
}));

function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// Helper to get mocked toast error
const getMockToastError = () => vi.mocked(toastModule.toast).error;

describe('useApiError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with no error', () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isVisible).toBe(false);
  });

  it('should handle APIError with status code 400 and show toast', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('VALIDATION_ERROR', 'Bad request', 'req-123', 400);

    await act(async () => {
      await result.current.handleError(apiError, { context: 'Creating user' });
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Invalid Request')
    );
    expect(result.current.error).not.toBeNull();
    expect(result.current.isVisible).toBe(true);
  });

  it('should handle APIError with status code 401 (unauthorized)', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('UNAUTHORIZED', 'Unauthorized', 'req-123', 401);

    await act(async () => {
      await result.current.handleError(apiError);
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Authentication Required')
    );
    expect(result.current.error).not.toBeNull();
  });

  it('should handle APIError with status code 403 (forbidden)', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('FORBIDDEN', 'Forbidden', 'req-123', 403);

    await act(async () => {
      await result.current.handleError(apiError);
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Access Denied')
    );
  });

  it('should handle APIError with status code 404 (not found)', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('NOT_FOUND', 'Not found', 'req-123', 404);

    await act(async () => {
      await result.current.handleError(apiError);
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Not Found')
    );
  });

  it('should handle APIError with status code 404 with context', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('NOT_FOUND', 'Not found', 'req-123', 404);

    await act(async () => {
      await result.current.handleError(apiError, { context: 'User profile' });
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('User profile')
    );
  });

  it('should handle APIError with status code 409 (conflict)', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('CONFLICT', 'Resource already exists', 'req-123', 409);

    await act(async () => {
      await result.current.handleError(apiError);
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Conflict')
    );
  });

  it('should handle APIError with status code 429 (rate limit)', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('RATE_LIMIT_EXCEEDED', 'Too many requests', 'req-123', 429);

    await act(async () => {
      await result.current.handleError(apiError);
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Too Many Requests')
    );
  });

  it('should handle APIError with status code 500 (server error)', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('INTERNAL_ERROR', 'Internal server error', 'req-123', 500);

    await act(async () => {
      await result.current.handleError(apiError);
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Server Error')
    );
  });

  it('should handle network errors (TypeError with fetch)', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const networkError = new TypeError('Failed to fetch');

    await act(async () => {
      await result.current.handleError(networkError, { context: 'Fetching data' });
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Network Error')
    );
    expect(result.current.error).not.toBeNull();
  });

  it('should handle generic Error objects', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const genericError = new Error('Something went wrong');

    await act(async () => {
      await result.current.handleError(genericError);
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalled();
    expect(result.current.error).not.toBeNull();
  });

  it('should handle unknown error types', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const unknownError = 'string error';

    await act(async () => {
      await result.current.handleError(unknownError);
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalled();
    expect(result.current.error).not.toBeNull();
  });

  it('should use fallback message when provided', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('UNKNOWN_ERROR', '', 'req-123', 499);

    await act(async () => {
      await result.current.handleError(apiError, {
        fallbackMessage: 'Custom fallback message',
      });
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Custom fallback message')
    );
  });

  it('should provide clearError function', () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.error).toBeNull();

    act(() => {
      result.current.setError(new Error('Test error'));
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toBe('Test error');

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isVisible).toBe(false);
  });

  it('should provide retry action', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const onRetry = vi.fn();

    await act(async () => {
      await result.current.handleError(new Error('Test error'), { onRetry });
    });

    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.retry();
    });

    expect(onRetry).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('should not call retry when no retry callback is set', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.handleError(new Error('Test error'));
    });

    act(() => {
      result.current.retry();
    });

    // Should not throw, just do nothing
    expect(result.current.error).not.toBeNull();
  });

  it('should clear retry callback on clearError', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const onRetry = vi.fn();

    await act(async () => {
      await result.current.handleError(new Error('Test error'), { onRetry });
    });

    act(() => {
      result.current.clearError();
    });

    act(() => {
      result.current.retry();
    });

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('should handle APIError with unknown status code', async () => {
    const { result } = renderHook(() => useApiError(), {
      wrapper: createTestWrapper(),
    });

    const apiError = new APIError('UNKNOWN_ERROR', 'Custom error message', 'req-123', 499);

    await act(async () => {
      await result.current.handleError(apiError);
    });

    const mockToastError = getMockToastError();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Custom error message')
    );
  });
});
