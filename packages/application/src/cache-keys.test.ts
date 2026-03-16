import { describe, expect, it } from 'vitest';
import {
  buildAiReadyJobCacheKey,
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

  it('builds ai-ready job cache keys with optional job id', () => {
    expect(buildAiReadyJobCacheKey('ws_demo', 'proj_demo', 'lib_docs')).toBe(
      'workspace:ws_demo:project:proj_demo:ai-ready-job:lib_docs',
    );
    expect(buildAiReadyJobCacheKey('ws_demo', 'proj_demo', 'lib_docs', 'airj_1')).toBe(
      'workspace:ws_demo:project:proj_demo:ai-ready-job:lib_docs:airj_1',
    );
  });
});
