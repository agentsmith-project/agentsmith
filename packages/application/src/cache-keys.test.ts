import { describe, expect, it } from 'vitest';
import {
  buildFileLibrariesCacheKey,
  buildSourcesCacheKey,
  buildWorkspaceProjectCacheKey,
} from './cache-keys';

describe('cache key helpers', () => {
  it('builds workspace-project scoped cache keys', () => {
    expect(buildWorkspaceProjectCacheKey('sources', 'ws_demo', 'proj_demo')).toBe(
      'workspace:ws_demo:project:proj_demo:sources',
    );
  });

  it('builds sources cache keys with and without library scope', () => {
    expect(buildSourcesCacheKey('ws_demo', 'proj_demo')).toBe(
      'workspace:ws_demo:project:proj_demo:sources:all',
    );
    expect(buildSourcesCacheKey('ws_demo', 'proj_demo', 'lib_docs')).toBe(
      'workspace:ws_demo:project:proj_demo:sources:lib_docs',
    );
  });

  it('builds file library cache keys', () => {
    expect(buildFileLibrariesCacheKey('ws_demo', 'proj_demo')).toBe(
      'workspace:ws_demo:project:proj_demo:file-libraries',
    );
  });
});
