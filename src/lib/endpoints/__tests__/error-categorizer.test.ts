/**
 * Error Categorizer Tests
 *
 * Tests for categorizing endpoint health check errors into
 * meaningful categories for user feedback.
 */

import { describe, it, expect } from 'vitest';
import { categorizeEndpointError } from '@/lib/endpoints/error-categorizer';
import type { EndpointHealthErrorCategory } from '@/lib/api/types/endpoints';

describe('Error Categorizer', () => {
  describe('HTTP Status Code Categorization', () => {
    it('should categorize 401 as auth error', () => {
      const result = categorizeEndpointError({ status: 401, message: 'Unauthorized' });
      expect(result).toBe('auth');
    });

    it('should categorize 403 as auth error', () => {
      const result = categorizeEndpointError({ status: 403, message: 'Forbidden' });
      expect(result).toBe('auth');
    });

    it('should categorize 429 as rate_limit error', () => {
      const result = categorizeEndpointError({ status: 429, message: 'Too Many Requests' });
      expect(result).toBe('rate_limit');
    });

    it('should categorize 500-599 as upstream error', () => {
      const result500 = categorizeEndpointError({ status: 500, message: 'Internal Server Error' });
      expect(result500).toBe('upstream');

      const result502 = categorizeEndpointError({ status: 502, message: 'Bad Gateway' });
      expect(result502).toBe('upstream');

      const result503 = categorizeEndpointError({ status: 503, message: 'Service Unavailable' });
      expect(result503).toBe('upstream');
    });

    it('should categorize 4xx (excluding 401/403/429) as upstream error', () => {
      const result = categorizeEndpointError({ status: 400, message: 'Bad Request' });
      expect(result).toBe('upstream');
    });
  });

  describe('Network Error Categorization', () => {
    it('should categorize ETIMEDOUT as timeout error', () => {
      const result = categorizeEndpointError({
        code: 'ETIMEDOUT',
        message: 'Connection timed out',
      });
      expect(result).toBe('timeout');
    });

    it('should categorize ECONNREFUSED as network error', () => {
      const result = categorizeEndpointError({
        code: 'ECONNREFUSED',
        message: 'Connection refused',
      });
      expect(result).toBe('network');
    });

    it('should categorize ENOTFOUND as network error', () => {
      const result = categorizeEndpointError({
        code: 'ENOTFOUND',
        message: 'DNS lookup failed',
      });
      expect(result).toBe('network');
    });

    it('should categorize ECONNRESET as network error', () => {
      const result = categorizeEndpointError({
        code: 'ECONNRESET',
        message: 'Connection reset',
      });
      expect(result).toBe('network');
    });
  });

  describe('Message-Based Categorization', () => {
    it('should categorize "auth" in message as auth error', () => {
      const result = categorizeEndpointError({
        message: 'Authentication failed: invalid API key',
      });
      expect(result).toBe('auth');
    });

    it('should categorize "timeout" in message as timeout error', () => {
      const result = categorizeEndpointError({
        message: 'Request timeout after 30s',
      });
      expect(result).toBe('timeout');
    });

    it('should categorize "rate limit" in message as rate_limit error', () => {
      const result = categorizeEndpointError({
        message: 'Rate limit exceeded',
      });
      expect(result).toBe('rate_limit');
    });
  });

  describe('Unknown Errors', () => {
    it('should return unknown for unrecognized errors', () => {
      const result = categorizeEndpointError({
        message: 'Some unknown error',
      });
      expect(result).toBe('unknown');
    });

    it('should return unknown for empty error objects', () => {
      const result = categorizeEndpointError({});
      expect(result).toBe('unknown');
    });
  });

  describe('Type Safety', () => {
    it('should return valid EndpointHealthErrorCategory types', () => {
      const validCategories: EndpointHealthErrorCategory[] = [
        'auth',
        'network',
        'upstream',
        'timeout',
        'rate_limit',
        'unknown',
      ];

      const result = categorizeEndpointError({ message: 'test' });
      expect(validCategories).toContain(result);
    });
  });
});
