/**
 * Error Categorizer
 *
 * Categorizes endpoint health check errors into meaningful categories
 * for user feedback and display.
 */

import type { EndpointHealthErrorCategory } from '@/lib/api/types/endpoints';

export interface EndpointError {
  status?: number;
  code?: string;
  message?: string;
}

/**
 * Categorizes an endpoint error into a meaningful category
 * @param error - The error object from the health check
 * @returns The error category for UI display
 */
export function categorizeEndpointError(error: EndpointError): EndpointHealthErrorCategory {
  const { status, code, message = '' } = error;

  // Check HTTP status codes
  if (status) {
    if (status === 401 || status === 403) {
      return 'auth';
    }
    if (status === 429) {
      return 'rate_limit';
    }
    if (status >= 500 && status < 600) {
      return 'upstream';
    }
    // Other 4xx errors are considered upstream (provider-side validation)
    if (status >= 400 && status < 500) {
      return 'upstream';
    }
  }

  // Check network error codes
  if (code) {
    const upperCode = code.toUpperCase();
    if (upperCode === 'ETIMEDOUT' || upperCode === 'TIMEOUT') {
      return 'timeout';
    }
    if (
      upperCode === 'ECONNREFUSED' ||
      upperCode === 'ENOTFOUND' ||
      upperCode === 'ECONNRESET' ||
      upperCode === 'ECONNABORTED' ||
      upperCode.includes('NET')
    ) {
      return 'network';
    }
  }

  // Check message content as fallback
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('auth') || lowerMessage.includes('unauthorized') || lowerMessage.includes('forbidden')) {
    return 'auth';
  }
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return 'timeout';
  }
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests')) {
    return 'rate_limit';
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
    return 'network';
  }

  // Default to unknown
  return 'unknown';
}

/**
 * Gets a user-friendly error message based on error category
 * @param category - The error category
 * @param defaultMessage - Optional default message
 * @returns User-friendly error message
 */
export function getErrorMessage(category: EndpointHealthErrorCategory, defaultMessage?: string): string {
  const messages: Record<EndpointHealthErrorCategory, string> = {
    auth: 'Authentication failed. Please check your API key or credentials.',
    network: 'Network error. Could not reach the endpoint. Please check your connection.',
    upstream: 'The provider returned an error. Please try again later.',
    timeout: 'Request timed out. The endpoint took too long to respond.',
    rate_limit: 'Rate limited. Too many requests were made. Please wait and try again.',
    unknown: 'An unknown error occurred. Please try again.',
  };

  return defaultMessage || messages[category];
}
