/**
 * User API Key Fixtures
 *
 * Mock user API key data for development and testing.
 */

import type { UserAPIKey } from '@/lib/api/types';

export const userAPIKeyFixtures: UserAPIKey[] = [
  {
    id: 'key_001',
    user_id: 'user_001',
    key_prefix: 'usk-***abc123xyz',
    status: 'active',
    note: 'Development key for local testing',
    created_at: '2026-01-15T10:00:00Z',
    expires_at: '2027-01-15T10:00:00Z',
    last_used_at: '2026-01-28T14:20:00Z',
  },
  {
    id: 'key_002',
    user_id: 'user_001',
    key_prefix: 'usk-***def456uvw',
    status: 'active',
    note: 'Production API key',
    created_at: '2026-01-20T11:30:00Z',
    expires_at: '2026-04-20T11:30:00Z',
    last_used_at: '2026-01-28T12:45:00Z',
  },
  {
    id: 'key_003',
    user_id: 'user_001',
    key_prefix: 'usk-***ghi789rst',
    status: 'active',
    note: 'Testing key for CI/CD',
    created_at: '2026-01-25T09:00:00Z',
    last_used_at: '2026-01-27T16:30:00Z',
  },
  {
    id: 'key_004',
    user_id: 'user_002',
    key_prefix: 'usk-***jkl012opq',
    status: 'active',
    created_at: '2026-01-18T14:00:00Z',
    expires_at: '2026-02-17T14:00:00Z',
    last_used_at: '2026-01-26T10:15:00Z',
  },
  {
    id: 'key_005',
    user_id: 'user_001',
    key_prefix: 'usk-***mno345lmn',
    status: 'revoked',
    note: 'Old key - no longer needed',
    created_at: '2026-01-05T08:00:00Z',
    last_used_at: '2026-01-18T12:00:00Z',
  },
  {
    id: 'key_006',
    user_id: 'user_003',
    key_prefix: 'usk-***pqr678ijk',
    status: 'active',
    created_at: '2026-01-22T10:00:00Z',
    expires_at: '2026-02-21T10:00:00Z',
  },
  {
    id: 'key_007',
    user_id: 'user_001',
    key_prefix: 'usk-***stu901efg',
    status: 'expired',
    note: 'Temporary key',
    created_at: '2025-12-01T00:00:00Z',
    expires_at: '2026-01-01T00:00:00Z',
    last_used_at: '2025-12-28T18:00:00Z',
  },
  {
    id: 'key_008',
    user_id: 'user_002',
    key_prefix: 'usk-***vwx234hij',
    status: 'suspended',
    note: 'Suspended due to unusual activity',
    created_at: '2026-01-10T11:00:00Z',
    last_used_at: '2026-01-24T09:30:00Z',
  },
];
