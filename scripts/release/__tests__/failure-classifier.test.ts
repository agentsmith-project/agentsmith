/**
 * TDD Tests for Failure Classification System (Epic D2)
 *
 * Tests for expanded failure pattern library with 90%+ accuracy target.
 * Covers token, network, backend, assertion, and additional failure types.
 *
 * RED-GREEN-REFACTOR sequence applies.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyFailure,
  getFailurePattern,
  getAllPatterns,
  getTroubleshootingSteps,
  type FailureType,
  type ClassifiedFailure,
} from '../failure-classifier';

describe('Failure Classifier: TDD Suite (Epic D2)', () => {
  describe('RED Phase 1: Token Failures - Expanded Patterns', () => {
    it('should classify JWT expired errors', () => {
      const error = 'jwt expired at 2026-02-27T10:30:00Z';
      const result = classifyFailure(error);
      expect(result.category).toBe('token');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should classify 401 Unauthorized errors', () => {
      const error = 'Request failed with status code 401 Unauthorized';
      const result = classifyFailure(error);
      expect(result.category).toBe('token');
    });

    it('should classify Keycloak authentication failures', () => {
      const error = 'Keycloak authentication failed: invalid_client_credentials';
      const result = classifyFailure(error);
      expect(result.category).toBe('token');
    });

    it('should classify OAuth token errors', () => {
      const error = 'OAuth error: invalid_token';
      const result = classifyFailure(error);
      expect(result.category).toBe('token');
    });

    it('should classify bearer token missing errors', () => {
      const error = 'Authorization header missing: Bearer token required';
      const result = classifyFailure(error);
      expect(result.category).toBe('token');
    });

    it('should classify invalid bearer token errors', () => {
      const error = 'POST /tasks/abc/messages -> 401: invalid bearer token';
      const result = classifyFailure(error);
      expect(result.category).toBe('token');
    });

    it('should provide specific troubleshooting steps for token failures', () => {
      const error = 'jwt expired';
      const result = classifyFailure(error);
      const steps = getTroubleshootingSteps(result.category);

      expect(steps).toBeDefined();
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[0]).toMatch(/refresh|token|auth/i);
    });
  });

  describe('RED Phase 2: Network Failures - Expanded Patterns', () => {
    it('should classify ECONNREFUSED errors', () => {
      const error = 'connect ECONNREFUSED 127.0.0.1:20000';
      const result = classifyFailure(error);
      expect(result.category).toBe('network');
    });

    it('should classification ETIMEDOUT errors', () => {
      const error = 'connect ETIMEDOUT 192.168.1.1:3000';
      const result = classifyFailure(error);
      expect(result.category).toBe('network');
    });

    it('should classify DNS resolution failures', () => {
      const error = 'getaddrinfo ENOTFOUND api.example.com';
      const result = classifyFailure(error);
      expect(result.category).toBe('network');
    });

    it('should classify socket hang up errors', () => {
      const error = 'socket hang up';
      const result = classifyFailure(error);
      expect(result.category).toBe('network');
    });

    it('should classify connection reset errors', () => {
      const error = 'read ECONNRESET';
      const result = classifyFailure(error);
      expect(result.category).toBe('network');
    });

    it('should classify network unreachable errors', () => {
      const error = 'Network unreachable';
      const result = classifyFailure(error);
      expect(result.category).toBe('network');
    });

    it('should classify fetch failed errors', () => {
      const error = 'TypeError: fetch failed';
      const result = classifyFailure(error);
      expect(result.category).toBe('network');
    });

    it('should provide troubleshooting steps for network failures', () => {
      const error = 'ECONNREFUSED';
      const result = classifyFailure(error);
      const steps = getTroubleshootingSteps(result.category);

      expect(steps).toBeDefined();
      expect(steps.some(s => s.includes('demo-status') || s.includes('BASE_URL'))).toBe(true);
    });
  });

  describe('RED Phase 3: Backend Failures - Expanded Patterns', () => {
    it('should classify 500 Internal Server Error', () => {
      const error = 'Request failed with status code 500';
      const result = classifyFailure(error);
      expect(result.category).toBe('backend');
    });

    it('should classify 502 Bad Gateway errors', () => {
      const error = '502 Bad Gateway';
      const result = classifyFailure(error);
      expect(result.category).toBe('backend');
    });

    it('should classify 503 Service Unavailable errors', () => {
      const error = '503 Service Unavailable';
      const result = classifyFailure(error);
      expect(result.category).toBe('backend');
    });

    it('should classify PostgreSQL connection errors', () => {
      const error = 'connection error: password authentication failed for user "mbos"';
      const result = classifyFailure(error);
      expect(result.category).toBe('backend');
    });

    it('should classify Redis connection errors', () => {
      const error = 'Redis connection to localhost:16379 failed';
      const result = classifyFailure(error);
      expect(result.category).toBe('backend');
    });

    it('should classify MongoDB timeout errors', () => {
      const error = 'MongoServerSelectionError: connect ETIMEDOUT';
      const result = classifyFailure(error);
      expect(result.category).toBe('backend');
    });

    it('should classify agent runtime protocol errors', () => {
      const error = 'AGENT_PROTOCOL_ERROR: invalid runtime response frame';
      const result = classifyFailure(error);
      expect(result.category).toBe('backend');
    });

    it('should provide troubleshooting steps for backend failures', () => {
      const error = '500 Internal Server Error';
      const result = classifyFailure(error);
      const steps = getTroubleshootingSteps(result.category);

      expect(steps).toBeDefined();
      expect(steps.some(s => s.includes('/tmp/agentsmith_demo_api.log'))).toBe(true);
    });
  });

  describe('RED Phase 4: Assertion Failures - Expanded Patterns', () => {
    it('should classify Vitest assertion failures', () => {
      const error = 'FAIL | expected "actual" to be "expected"';
      const result = classifyFailure(error);
      expect(result.category).toBe('assertion');
    });

    it('should classify Playwright expectation failures', () => {
      const error = 'Error: expect(locator).toBeVisible()';
      const result = classifyFailure(error);
      expect(result.category).toBe('assertion');
    });

    it('should classify element not found errors', () => {
      const error = 'Error: locator.click: Target closed';
      const result = classifyFailure(error);
      expect(result.category).toBe('assertion');
    });

    it('should classify timeout waiting for element errors', () => {
      const error = 'Error: locator.click: Timeout 30000ms exceeded';
      const result = classifyFailure(error);
      expect(result.category).toBe('assertion');
    });

    it('should provide troubleshooting steps for assertion failures', () => {
      const error = 'expected "actual" to be "expected"';
      const result = classifyFailure(error);
      const steps = getTroubleshootingSteps(result.category);

      expect(steps).toBeDefined();
      expect(steps.some(s => s.includes('selector') || s.includes('test'))).toBe(true);
    });

    it('should classify second-turn output mismatch as assertion', () => {
      const error = 'Second turn agent message did not produce expected output: ...';
      const result = classifyFailure(error);
      expect(result.category).toBe('assertion');
    });
  });

  describe('RED Phase 4.5: Timeout and Rate-limit Script Errors', () => {
    it('should classify missing terminal trace timeout errors', () => {
      const error = 'task t_123 did not reach terminal trace within timeout';
      const result = classifyFailure(error);
      expect(result.category).toBe('timeout');
    });

    it('should classify retry limit errors as rate_limit', () => {
      const error = 'provider reply failed due to retry limit';
      const result = classifyFailure(error);
      expect(result.category).toBe('rate_limit');
    });
  });

  describe('RED Phase 5: Classification Accuracy (90%+ Target)', () => {
    // Real-world error samples collected from actual test runs
    const realErrorSamples = [
      { error: 'jwt expired', expected: 'token' },
      { error: '401 Unauthorized', expected: 'token' },
      { error: 'Keycloak: 403 Forbidden', expected: 'token' },
      { error: 'ECONNREFUSED 127.0.0.1:20000', expected: 'network' },
      { error: 'ETIMEDOUT', expected: 'network' },
      { error: 'ENOTFOUND api.local', expected: 'network' },
      { error: '500 Internal Server Error', expected: 'backend' },
      { error: '502 Bad Gateway', expected: 'backend' },
      { error: 'PostgreSQL connection failed', expected: 'backend' },
      { error: 'expected true to be false', expected: 'assertion' },
      { error: 'locator.click: Timeout exceeded', expected: 'assertion' },
      { error: 'Error: Target closed', expected: 'assertion' },
    ];

    it('should classify all sample errors correctly', () => {
      let correct = 0;
      const total = realErrorSamples.length;

      for (const sample of realErrorSamples) {
        const result = classifyFailure(sample.error);
        if (result.category === sample.expected) {
          correct++;
        }
      }

      const accuracy = (correct / total) * 100;
      console.log(`Classification accuracy: ${accuracy.toFixed(1)}% (${correct}/${total})`);

      // Target: 90% accuracy
      expect(accuracy).toBeGreaterThanOrEqual(90);
    });

    it('should return confidence score for each classification', () => {
      const result = classifyFailure('jwt expired');

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should handle unknown errors gracefully', () => {
      const result = classifyFailure('Some completely unknown error message');

      expect(result.category).toBe('unknown');
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('RED Phase 6: Troubleshooting Guide Integration', () => {
    it('should return pattern details for each category', () => {
      const categories: FailureType[] = ['token', 'network', 'backend', 'assertion'];

      for (const category of categories) {
        const pattern = getFailurePattern(category);

        expect(pattern).toBeDefined();
        expect(pattern.category).toBe(category);
        expect(pattern.recommendation).toBeDefined();
        expect(pattern.recommendation.length).toBeGreaterThan(0);
      }
    });

    it('should return all available patterns', () => {
      const patterns = getAllPatterns();

      expect(patterns.length).toBeGreaterThanOrEqual(4);
      expect(patterns.every(p => p.category && p.patterns && p.recommendation)).toBe(true);
    });

    it('should include document links in recommendations', () => {
      const tokenPattern = getFailurePattern('token');

      expect(tokenPattern.documentationLink).toMatch(/\/docs\//);
    });
  });

  describe('RED Phase 7: Edge Cases', () => {
    it('should handle empty error message', () => {
      const result = classifyFailure('');

      expect(result.category).toBe('unknown');
    });

    it('should handle null/undefined error message', () => {
      const result = classifyFailure((null as unknown) as string);

      expect(result.category).toBe('unknown');
    });

    it('should handle multiline error messages', () => {
      const error = `
Error: Command failed
Exit code: 1
stdout: some output
stderr: ECONNREFUSED 127.0.0.1:20000
      `.trim();

      const result = classifyFailure(error);
      expect(result.category).toBe('network');
    });

    it('should prioritize specific patterns over generic ones', () => {
      // "timeout" appears in both network and assertion categories
      // Network should take priority for connection timeouts
      const error = 'connect ETIMEDOUT 127.0.0.1:20000';
      const result = classifyFailure(error);

      expect(result.category).toBe('network');
      expect(result.matchedPattern).toBeDefined();
    });
  });
});

// Helper function to verify classification accuracy
export function calculateAccuracy(samples: Array<{ error: string; expected: FailureType }>): number {
  let correct = 0;
  for (const sample of samples) {
    const result = classifyFailure(sample.error);
    if (result.category === sample.expected) {
      correct++;
    }
  }
  return (correct / samples.length) * 100;
}
