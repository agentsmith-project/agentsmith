import { describe, expect, it } from 'vitest';
import {
  buildFileLibrariesCacheKey,
  buildWorkspaceProjectCacheKey,
} from './cache-keys';

describe('cache key helpers', () => {
  it('builds workspace-project scoped cache keys', () => {
    expect(buildWorkspaceProjectCacheKey('sources', 'ws_demo', 'proj_demo')).toBe(
      'workspace:ws_demo:project:proj_demo:sources',
    );
  });

  it('builds file library cache keys', () => {
    expect(buildFileLibrariesCacheKey('ws_demo', 'proj_demo')).toBe(
      'workspace:ws_demo:project:proj_demo:file-libraries',
    );
  });
});
