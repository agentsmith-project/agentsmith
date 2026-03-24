/**
 * Failure Classification System (Epic D2)
 *
 * Expanded pattern library for 90%+ classification accuracy.
 * Provides troubleshooting steps and documentation links for each failure type.
 */

/**
 * Classified failure result
 */
export interface ClassifiedFailure {
  /** The failure category */
  category: FailureType;
  /** Confidence score (0-1) based on pattern match strength */
  confidence: number;
  /** The specific pattern that matched */
  matchedPattern?: RegExp;
  /** Raw error message */
  rawError: string;
}

/**
 * Failure pattern definition
 */
export interface FailurePattern {
  /** Category type */
  category: FailureType;
  /** Regex patterns to match */
  patterns: RegExp[];
  /** Specific recommendation */
  recommendation: string;
  /** Link to troubleshooting documentation */
  documentationLink: string;
  /** Priority (higher = checked first) */
  priority: number;
  /** Step-by-step troubleshooting steps */
  steps: string[];
}

/**
 * Failure types
 */
export type FailureType =
  | 'token'       // Auth token issues
  | 'network'     // Network issues
  | 'backend'     // Backend errors
  | 'assertion'   // Test assertion failures
  | 'timeout'     // Timeout issues (distinct from network)
  | 'authorization' // Authorization/governance issues (Epic A)
  | 'spending_limit' // Spending limit exceeded (Epic A)
  | 'rate_limit'  // Rate limited (Epic A)
  | 'permission'  // Permission/access issues
  | 'unknown';    // Unclassified

/**
 * Expanded failure patterns library (Epic D2)
 * Target: 90%+ classification accuracy on real-world errors
 *
 * Pattern Priority Order Matters!
 * More specific patterns must come before generic ones.
 */
const FAILURE_PATTERNS: FailurePattern[] = [
  // BACKEND - Highest priority (most specific patterns first)
  // Must come before token/network to avoid false positives
  {
    category: 'backend',
    patterns: [
      /password\s+authentication\s+failed/i,
      /postgres.*error/i,
      /postgresql.*error/i,
      /PostgreSQL/i,
      /postgres/i,
      /psql.*error/i,
      /relation.*does\s+not\s+exist/i,
      /MongoServerSelectionError/i,
      /mongodb.*error/i,
      /mongo.*error/i,
      /redis.*connection.*failed/i,
      /redis.*error/i,
      /connection\s+failed/i,  // Generic connection failure = backend
      /TASK_STREAM_CONFLICT/i,
      /AGENT_OFFLINE/i,
      /AGENT_TIMEOUT/i,
      /AGENT_PROTOCOL_ERROR/i,
      /AGENT_UPSTREAM_ERROR/i,
      /500\s+internal\s+server\s+error/i,
      /502\s+bad\s+gateway/i,
      /503\s+service\s+unavailable/i,
      /504\s+gateway\s+timeout/i,
      /5\d\d\b/i,  // All 5xx errors (word boundary to avoid 5xx in middle of text)
      /backend\s+error/i,
      /api\s+error/i,
      /server\s+error/i,
      /database\s+error/i,
    ],
    recommendation: 'Backend error: Check API logs at artifacts/real-lane/current/demo/api.log',
    documentationLink: '/docs/troubleshooting-guide-v1.md#backend-issues',
    priority: 100,
    steps: [
      '1. Check API logs: `tail -100 artifacts/real-lane/current/demo/api.log`',
      '2. Check backend status: `make dev-real-status`',
      '3. Verify database is running: `docker ps | grep postgres`',
      '4. Verify Redis is running: `docker ps | grep redis`',
      '5. Check database connectivity: `npm run integration:deps:smoke`',
      '6. Restart API if needed: `make api-dev`',
    ],
  },
  // ASSERTION - High priority (specific test failures)
  {
    category: 'assertion',
    patterns: [
      /locator\.(click|fill|selectOption).*timeout/i,
      /locator\..*\.\s*timeout/i,
      /target\s+closed/i,
      /expect\(locator\)\./i,
      /expect\([^)]+\)\.toBe/i,
      /expected\s+".*"\s+to\s+be\s+"/i,
      /expected\s+\w+\s+to\s+be/i,
      /expected\s+status\s+\d+\s+but\s+got\s+\d+/i,
      /to\s+equal.*but\s+got/i,
      /\.\.should\./i,
      /assertion.*fail/i,
      /assert\s+error/i,
      /element.*not\s+found/i,
      /selector.*not\s+found/i,
      /getbyrole.*not\s+found/i,
      /getbytext.*not\s+found/i,
      /getbytestid.*not\s+found/i,
      /waiting.*failed/i,
      /test.*fail.*spec/i,
      /vitest.*fail/i,
      /playwright.*assertion/i,
      /url-summary\.txt artifact not found/i,
      /second turn agent message did not produce expected output/i,
    ],
    recommendation: 'Assertion failure: Check test output for specific expectation mismatch.',
    documentationLink: '/docs/troubleshooting-guide-v1.md#assertion-failures',
    priority: 95,
    steps: [
      '1. Review test output for specific assertion that failed',
      '2. Check if selector/data-testid is correct',
      '3. Verify element exists in DOM: use browser DevTools',
      '4. Check for timing issues: add await for async operations',
      '5. Verify test data/fixtures are correct',
      '6. Run test in debug mode: `npm run test:e2e:debug`',
    ],
  },
  // TOKEN - Authentication issues
  {
    category: 'token',
    patterns: [
      /jwt\s+expir/i,
      /token\s+expir/i,
      /401\s+unauthorized/i,
      /unauthorized/i,
      /403\s+forbidden/i,
      /\bforbidden\b/i,  // word boundary
      /invalid_token/i,
      /invalid\s+token/i,
      /invalid\s+bearer\s+token/i,
      /status\s+code\s+401/i,
      /keycloak.*auth/i,
      /oauth.*error/i,
      /bearer\s+token/i,
      /authorization.*header/i,
      /credentials.*required/i,
      /access\s+token/i,
      /refresh\s+token/i,
    ],
    recommendation: 'Token issue: Run `make notebook-agent-refresh-token` and retry.',
    documentationLink: '/docs/troubleshooting-guide-v1.md#token-issues',
    priority: 90,
    steps: [
      '1. Check if token has expired (tokens typically expire after 1 hour)',
      '2. Run: `make notebook-agent-refresh-token`',
      '3. If refresh fails, check Keycloak is running: `make dev-real-status`',
      '4. Verify environment variables: KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID',
      '5. Check token file: `cat artifacts/real-lane/current/token.txt`',
    ],
  },
  // NETWORK - Connection issues (must come before timeout for ETIMEDOUT)
  {
    category: 'network',
    patterns: [
      /connect\s+ETIMEDOUT/i,  // Connection timeout = network issue
      /ETIMEDOUT$/i,           // ETIMEDOUT at end of error = network
      /\bETIMEDOUT\b/i,        // ETIMEDOUT as whole word = network
      /ECONNREFUSED/i,
      /connection\s+refused/i,
      /connect\s+ECONNREFUSED/i,
      /ENOTFOUND/i,
      /DNS\s+error/i,
      /getaddrinfo/i,
      /socket\s+hang\s+up/i,
      /ECONNRESET/i,
      /connection\s+reset/i,
      /network\s+unreachable/i,
      /ENETUNREACH/i,
      /socket\s+error/i,
      /fetch\s+failed/i,
    ],
    recommendation: 'Network issue: Check services are running (`make dev-real-status`).',
    documentationLink: '/docs/troubleshooting-guide-v1.md#network-issues',
    priority: 90,  // Higher than timeout
    steps: [
      '1. Check service status: `make dev-real-status`',
      '2. Verify API_BASE is correct: http://localhost:20000',
      '3. Verify BASE_URL is correct: http://localhost:3001',
      '4. Check if ports are in use: `lsof -i :20000 -i :3001`',
      '5. Restart services if needed: `make dev-real-down && make dev-real-up && make dev-real-seed-notebook`',
      '6. Check for proxy interference (clear http_proxy, https_proxy)',
    ],
  },
  // TIMEOUT - Timeout issues (not connection timeout)
  {
    category: 'timeout',
    patterns: [
      /timeout\s+\d+ms\s+exceeded/i,
      /timed\s+out\s+after/i,
      /operation\s+timed\s+out/i,
      /request\s+timeout/i,
      /did\s+not\s+reach\s+terminal\s+trace\s+within\s+timeout/i,
      // Note: ETIMEDOUT is handled by network category (connect timeout)
    ],
    recommendation: 'Timeout: Increase timeout or check for slow operations.',
    documentationLink: '/docs/troubleshooting-guide-v1.md#timeout-issues',
    priority: 80,
    steps: [
      '1. Check if system is under heavy load',
      '2. Increase timeout in test config or playwright.config',
      '3. Check for infinite loops or blocking operations',
      '4. Verify async/await is used correctly',
    ],
  },
  // AUTHORIZATION - Governance/Authorization issues (Epic A)
  {
    category: 'authorization',
    patterns: [
      /permission\s+denied\s+by\s+policy/i,
      /subject\s+not\s+in\s+allow\s+list/i,
      /authorization\s+failed/i,
      /not\s+granted/i,
      /group\s+required/i,
      /role\s+not\s+assigned/i,
    ],
    recommendation: 'Authorization issue: Use POST /authorize API to explain denial reason.',
    documentationLink: '/docs/troubleshooting-guide-v1.md#authorization-governance-issues',
    priority: 75,
    steps: [
      '1. Use POST /authorize API to get detailed denial reason',
      '2. Check member permissions in UI: Members page',
      '3. Verify workspace/project membership',
      '4. Review resource policy settings',
      '5. Check if you are in allowed groups',
    ],
  },
  // SPENDING_LIMIT - Spending limit exceeded (Epic A)
  {
    category: 'spending_limit',
    patterns: [
      /resource_policy_spending_limited/i,
      /spending[_\\s-]*limit(ed)?/i,
      /spending[_\\s-]*capped/i,
      /limit\s+exceeded/i,
      /limit\s+limit\s+reached/i,
      /daily\s+limit\s+exhausted/i,
      /usage\s+limit\s+exceeded/i,
      /resource\s+limit\s+exceeded/i,
    ],
    recommendation: 'Spending limit issue: Check usage stats and spending limits.',
    documentationLink: '/docs/troubleshooting-guide-v1.md#authorization-governance-issues',
    priority: 72,
    steps: [
      '1. Check current usage: Usage page in UI',
      '2. Verify spending limits for your project',
      '3. Check if spending limits can be adjusted in Resource Policy',
      '4. Review usage breakdown by resource type',
    ],
  },
  // RATE_LIMIT - Rate limiting (Epic A)
  {
    category: 'rate_limit',
    patterns: [
      /rate\s+limit\s+exceeded/i,
      /too\s+many\s+requests/i,
      /429\s+too\s+many\s+requests/i,
      /throttled/i,
      /request\s+limit\s+reached/i,
      /retry\s+limit/i,
    ],
    recommendation: 'Rate limit: Wait and retry, or request rate limit increase.',
    documentationLink: '/docs/troubleshooting-guide-v1.md#authorization-governance-issues',
    priority: 71,
    steps: [
      '1. Wait before retrying (respect retry-after header)',
      '2. Check current request rate',
      '3. Review rate limit settings in Resource Policy',
      '4. Consider batching requests if possible',
    ],
  },
  // PERMISSION - General access control issues
  {
    category: 'permission',
    patterns: [
      /access\s+denied/i,
      /not\s+authorized/i,
      /insufficient\s+permissions/i,
      /permission\s+denied/i,
      /role\s+required/i,
      /scope\s+required/i,
    ],
    recommendation: 'Permission issue: Check user roles and permissions.',
    documentationLink: '/docs/troubleshooting-guide-v1.md#permission-issues',
    priority: 70,
    steps: [
      '1. Check user has required role: admin/member permissions',
      '2. Verify workspace/project membership',
      '3. Check resource policy settings',
      '4. Review member permissions in UI: Members page',
    ],
  },
];

/**
 * Classify a failure error message into a category
 *
 * @param error - The error message to classify
 * @returns Classified failure with category and confidence
 */
export function classifyFailure(error: string | Error | unknown): ClassifiedFailure {
  let errorMessage = '';

  // Extract error message from various input types
  if (typeof error === 'string') {
    errorMessage = error;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  } else if (error && typeof error === 'object' && 'message' in error) {
    errorMessage = String(error.message);
  } else {
    errorMessage = String(error);
  }

  const normalizedError = errorMessage.toLowerCase();

  // Sort patterns by priority (highest first)
  const sortedPatterns = [...FAILURE_PATTERNS].sort((a, b) => b.priority - a.priority);

  // Try to match against each pattern
  for (const pattern of sortedPatterns) {
    for (const regex of pattern.patterns) {
      if (regex.test(errorMessage)) {
        // Calculate confidence based on pattern specificity
        const confidence = calculateConfidence(regex, errorMessage);

        return {
          category: pattern.category,
          confidence,
          matchedPattern: regex,
          rawError: errorMessage,
        };
      }
    }
  }

  // No match found
  return {
    category: 'unknown',
    confidence: 0,
    rawError: errorMessage,
  };
}

/**
 * Calculate confidence score based on pattern match
 */
function calculateConfidence(pattern: RegExp, error: string): number {
  const match = error.match(pattern);
  if (!match) return 0;

  // Base confidence for any match
  let confidence = 0.6;

  // Longer patterns = more specific = higher confidence
  const patternLength = pattern.source.length;
  confidence += Math.min(patternLength / 50, 0.25);

  // Exact match (full error matches) = very high confidence
  if (match[0] && match[0].length === error.length) {
    confidence = 1.0;
  }

  // Multiple matches in same error = higher confidence
  const allMatches = error.match(new RegExp(pattern.source, 'gi'));
  if (allMatches && allMatches.length > 1) {
    confidence += 0.15;
  }

  // Word boundaries = more specific match
  if (pattern.source.includes('\\b') || pattern.source.includes('^') || pattern.source.includes('$')) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}

/**
 * Get failure pattern details for a category
 *
 * @param category - The failure category
 * @returns Failure pattern or undefined if not found
 */
export function getFailurePattern(category: FailureType): FailurePattern | undefined {
  return FAILURE_PATTERNS.find(p => p.category === category);
}

/**
 * Get all available failure patterns
 *
 * @returns Array of all failure patterns
 */
export function getAllPatterns(): FailurePattern[] {
  return [...FAILURE_PATTERNS].sort((a, b) => b.priority - a.priority);
}

/**
 * Get troubleshooting steps for a failure category
 *
 * @param category - The failure category
 * @returns Array of troubleshooting steps
 */
export function getTroubleshootingSteps(category: FailureType): string[] {
  const pattern = getFailurePattern(category);
  return pattern?.steps || ['No specific steps available for this failure type.'];
}

/**
 * Get quick recommendation for a failure category
 *
 * @param category - The failure category
 * @returns Recommendation string
 */
export function getQuickRecommendation(category: FailureType): string {
  const pattern = getFailurePattern(category);
  return pattern?.recommendation || 'Unknown error: Check logs for details.';
}

/**
 * Get documentation link for a failure category
 *
 * @param category - The failure category
 * @returns Documentation link
 */
export function getDocumentationLink(category: FailureType): string {
  const pattern = getFailurePattern(category);
  return pattern?.documentationLink || '/docs/troubleshooting-guide-v1.md';
}

/**
 * Classify multiple errors and return summary
 *
 * @param errors - Array of error messages
 * @returns Summary by category
 */
export function classifyMultiple(errors: string[]): Record<FailureType, number> {
  const summary: Record<string, number> = {};

  for (const error of errors) {
    const result = classifyFailure(error);
    summary[result.category] = (summary[result.category] || 0) + 1;
  }

  return summary as Record<FailureType, number>;
}

/**
 * Get most common failure category from multiple errors
 *
 * @param errors - Array of error messages
 * @returns The most common failure category
 */
export function getMostCommonFailure(errors: string[]): FailureType {
  const summary = classifyMultiple(errors);
  let maxCount = 0;
  let mostCommon: FailureType = 'unknown';

  for (const [category, count] of Object.entries(summary)) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = category as FailureType;
    }
  }

  return mostCommon;
}
