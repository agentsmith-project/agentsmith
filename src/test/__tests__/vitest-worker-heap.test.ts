// @vitest-environment node

import { describe, expect, it } from 'vitest';
import config from '../../../vitest.config';

describe('Vitest worker heap contract', () => {
  it('passes the configured heap limit to fork workers', () => {
    expect(config.test?.pool).toBe('forks');
    expect(config.test?.execArgv).toContain('--max-old-space-size=6144');
  });
});
