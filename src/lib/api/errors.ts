/**
 * API Error Handling
 *
 * Types and utilities for handling API errors.
 */

import type { ErrorResponse } from './types';

// ============================================================
// Error Types
// ============================================================

export class APIError extends Error {
  constructor(
    public errorCode: string,
    public message: string,
    public requestId: string,
    public statusCode?: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'APIError';
  }

  /**
   * Create APIError from response
   */
  static fromResponse(data: ErrorResponse, statusCode?: number): APIError {
    return new APIError(
      data.error_code,
      data.message,
      data.request_id,
      statusCode,
      data.details
    );
  }

  /**
   * Check if error is a network error
   */
  isNetworkError(): boolean {
    return this.errorCode === 'NETWORK_ERROR' || this.errorCode === 'TIMEOUT';
  }

  /**
   * Check if error is an authentication error
   */
  isAuthError(): boolean {
    return this.statusCode === 401 || this.errorCode === 'UNAUTHORIZED';
  }

  /**
   * Check if error is a permission error
   */
  isPermissionError(): boolean {
    return this.statusCode === 403 || this.errorCode === 'FORBIDDEN';
  }

  /**
   * Check if error is a not found error
   */
  isNotFoundError(): boolean {
    return this.statusCode === 404 || this.errorCode === 'NOT_FOUND';
  }

  /**
   * Check if error is a validation error
   */
  isValidationError(): boolean {
    return this.statusCode === 400 || this.errorCode === 'VALIDATION_ERROR';
  }

  /**
   * Check if error is a rate limit error
   */
  isRateLimitError(): boolean {
    return this.statusCode === 429 || this.errorCode === 'RATE_LIMIT_EXCEEDED';
  }

  /**
   * Check if error is a server error
   */
  isServerError(): boolean {
    return this.statusCode !== undefined && this.statusCode >= 500;
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    // Special error codes with custom messages
    const customMessages: Record<string, string> = {
      NETWORK_ERROR: 'Network connection failed. Please check your internet connection.',
      TIMEOUT: 'Request timed out. Please try again.',
      UNAUTHORIZED: 'You are not authorized. Please log in.',
      FORBIDDEN: 'You do not have permission to perform this action.',
      NOT_FOUND: 'The requested resource was not found.',
      VALIDATION_ERROR: 'Please check your input and try again.',
      RATE_LIMIT_EXCEEDED: 'Too many requests. Please wait and try again.',
      INTERNAL_ERROR: 'An unexpected error occurred. Please try again later.',
    };

    return customMessages[this.errorCode] || this.message;
  }
}

// ============================================================
// Error Parsing Utilities
// ============================================================

/**
 * Parse error from fetch response
 */
export async function parseErrorResponse(response: Response): Promise<APIError> {
  try {
    const data = await response.json();
    if (isErrorResponse(data)) {
      return APIError.fromResponse(data, response.status);
    }
  } catch {
    // If parsing fails, create a generic error
  }

  // Generic error if we can't parse the response
  return new APIError(
    'UNKNOWN_ERROR',
    response.statusText || 'An unknown error occurred',
    '',
    response.status
  );
}

/**
 * Check if object is an ErrorResponse
 */
export function isErrorResponse(obj: unknown): obj is ErrorResponse {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'error_code' in obj &&
    'message' in obj &&
    'request_id' in obj
  );
}

/**
 * Parse error from EventSource (SSE)
 */
export function parseSSEError(event: MessageEvent): APIError | null {
  try {
    const data = JSON.parse(event.data);
    if (isErrorResponse(data)) {
      return APIError.fromResponse(data);
    }
  } catch {
    return null;
  }
  return null;
}

// ============================================================
// Error Message Formatting
// ============================================================

/**
 * Format error for toast notification
 */
export function formatErrorForToast(error: APIError | Error, t?: (key: string) => string): string {
  if (error instanceof APIError) {
    return error.getUserMessage();
  }
  if (t) {
    return error.message || t('unknown_error');
  }
  return error.message || 'An unexpected error occurred';
}

/**
 * Handle error and show toast (non-hook version for use in callbacks)
 * This can be used in React Query onError callbacks where hooks can't be used
 */
export function handleErrorForToast(error: unknown, context?: string): void {
  // Use synchronous imports - toast and ApiError are already available
  // This avoids async issues in callbacks
  const { toast } = require('@/components/ui/toast');
  const { ApiError } = require('./client');
  
  if (error instanceof ApiError) {
    const message = formatErrorForToast(error);
    toast.error(message);
    if (context) {
      console.error(`[${context}]`, error);
    }
  } else if (error instanceof Error) {
    toast.error(error.message || 'An unexpected error occurred');
    if (context) {
      console.error(`[${context}]`, error);
    }
  } else {
    toast.error('An unexpected error occurred');
    if (context) {
      console.error(`[${context}]`, error);
    }
  }
}

/**
 * Format error with request ID for debugging
 */
export function formatErrorWithRequestID(error: APIError | Error): string {
  if (error instanceof APIError && error.requestId) {
    return `${error.getUserMessage()}\n\nRequest ID: ${error.requestId}`;
  }
  return error.message || 'An unexpected error occurred';
}

/**
 * Copy request ID to clipboard (for user to report)
 */
export async function copyRequestID(error: APIError): Promise<boolean> {
  if (!error.requestId) return false;

  try {
    await navigator.clipboard.writeText(error.requestId);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Error Handlers
// ============================================================

/**
 * Handle API error with appropriate actions
 */
export function handleAPIError(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  if (error instanceof Error) {
    // Convert standard errors to APIError
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return new APIError('NETWORK_ERROR', error.message, '', undefined);
    }

    if (error.name === 'AbortError') {
      return new APIError('TIMEOUT', 'Request was cancelled or timed out', '', undefined);
    }

    return new APIError('UNKNOWN_ERROR', error.message, '', undefined);
  }

  return new APIError('UNKNOWN_ERROR', 'An unknown error occurred', '', undefined);
}

/**
 * Get error handling suggestions
 */
export function getErrorSuggestions(error: APIError): string[] {
  const suggestions: string[] = [];

  if (error.isNetworkError() || error.isServerError()) {
    suggestions.push('Check your internet connection');
    suggestions.push('Try refreshing the page');
    suggestions.push('If the problem persists, contact support');
  }

  if (error.isAuthError()) {
    suggestions.push('You may need to log in again');
    suggestions.push('Your session may have expired');
  }

  if (error.isPermissionError()) {
    suggestions.push('You do not have permission to perform this action');
    suggestions.push('Contact your project administrator for access');
  }

  if (error.isRateLimitError()) {
    suggestions.push('You have made too many requests');
    suggestions.push('Please wait a moment before trying again');
  }

  if (error.isValidationError()) {
    suggestions.push('Check your input for any errors');
    suggestions.push('Make sure all required fields are filled');
  }

  if (error.requestId) {
    suggestions.push(`Request ID: ${error.requestId} (include this when reporting issues)`);
  }

  return suggestions;
}
