import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceProjectCacheKey,
} from './cache-keys';

describe('cache key helpers', () => {
  it('builds workspace-project scoped cache keys', () => {
    expect(buildWorkspaceProjectCacheKey('sources', 'ws_demo', 'proj_demo')).toBe(
      'workspace:ws_demo:project:proj_demo:sources',
    );
  });

});
