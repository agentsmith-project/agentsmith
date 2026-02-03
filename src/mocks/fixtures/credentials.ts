/**
 * Credential Fixtures
 *
 * Mock credential data for development and testing.
 * Secrets are stored separately and never returned.
 */

import type { Credential } from '@/lib/api/types';

export const credentialFixtures: Credential[] = [
  {
    id: 'cred_001',
    workspace_id: 'ws_test',
    project_id: 'proj_001',
    name: 'OpenAI API Key',
    type: 'api_key',
    fingerprint: '••••••••••••xyz1',
    created_at: '2026-01-10T09:00:00Z',
    last_rotated_at: '2026-01-25T14:20:00Z',
  },
  {
    id: 'cred_002',
    workspace_id: 'ws_test',
    project_id: 'proj_001',
    name: 'Anthropic API Key',
    type: 'api_key',
    fingerprint: '••••••••••••abc2',
    created_at: '2026-01-12T10:00:00Z',
  },
];

/** In-memory secret store for mock only - never returned in API responses */
export const credentialSecrets: Record<string, string> = {};
