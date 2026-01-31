/**
 * Workspace Fixtures
 *
 * Mock workspace data for development and testing.
 */

import type { Workspace } from '@/lib/api/types';

export const workspaceFixtures: Workspace[] = [
  {
    id: 'ws_default',
    name: 'Default Workspace',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'ws_test',
    name: 'Test Workspace',
    created_at: '2026-01-05T00:00:00Z',
    updated_at: '2026-01-20T00:00:00Z',
  },
];
