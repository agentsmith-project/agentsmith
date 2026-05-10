import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/lib/query-keys';

describe('queryKeys scope contracts', () => {
  it('keeps task scope distinct from list keys with params', () => {
    expect(queryKeys.tasks.scope('ws_default', 'proj_001')).toEqual([
      'tasks',
      'ws_default',
      'proj_001',
    ]);
    expect(queryKeys.tasks.list('ws_default', 'proj_001')).toEqual([
      'tasks',
      'ws_default',
      'proj_001',
      undefined,
    ]);
  });

  it('provides param-free scope keys for other filtered resources', () => {
    expect(queryKeys.files.scope('ws_default', 'proj_001')).toEqual([
      'files',
      'ws_default',
      'proj_001',
    ]);
    expect(queryKeys.audit.scope('ws_default', 'proj_001')).toEqual([
      'audit',
      'ws_default',
      'proj_001',
    ]);
    expect(queryKeys.usage.scope('ws_default', 'proj_001')).toEqual([
      'usage',
      'ws_default',
      'proj_001',
    ]);
  });

  it('scopes file-library recovery and task-file-template caches by project and library', () => {
    expect(queryKeys.fileLibraries.savePoints('ws_default', 'proj_001', 'lib_1')).toEqual([
      'file-library-save-points',
      'ws_default',
      'proj_001',
      'lib_1',
    ]);
    expect(queryKeys.taskFileTemplates.list('ws_default', 'proj_001')).toEqual([
      'task-file-templates',
      'ws_default',
      'proj_001',
    ]);
  });
});
