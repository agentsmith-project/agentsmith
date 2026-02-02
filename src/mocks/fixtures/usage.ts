/**
 * Usage Statistics Fixtures
 *
 * Mock usage record data for development and testing.
 */

import type { UsageRecord } from '@/lib/api/types';

export const usageRecordFixtures: UsageRecord[] = [
  // Today's hourly records
  {
    id: 'usage_001',
    time_bucket: '2026-01-28 14:00',
    workspace_id: 'ws_001',
    project_id: 'proj_001',
    resource_type: 'endpoints',
    resource_id: 'endpoint_001',
    end_user_id: 'user_001',
    requests: 145,
    duration_p95_ms: 2100,
    bytes_in: 256000,
    bytes_out: 5120000,
    tokens: 125000,
  },
  {
    id: 'usage_002',
    time_bucket: '2026-01-28 13:00',
    workspace_id: 'ws_001',
    project_id: 'proj_001',
    resource_type: 'endpoints',
    resource_id: 'endpoint_001',
    end_user_id: 'user_001',
    requests: 132,
    duration_p95_ms: 1950,
    bytes_in: 235000,
    bytes_out: 4890000,
    tokens: 118000,
  },
  {
    id: 'usage_003',
    time_bucket: '2026-01-28 12:00',
    workspace_id: 'ws_001',
    project_id: 'proj_001',
    resource_type: 'endpoints',
    resource_id: 'endpoint_002',
    end_user_id: 'user_002',
    requests: 89,
    duration_p95_ms: 3200,
    bytes_in: 180000,
    bytes_out: 4200000,
    tokens: 95000,
  },
  {
    id: 'usage_004',
    time_bucket: '2026-01-28 14:00',
    workspace_id: 'ws_001',
    project_id: 'proj_001',
    resource_type: 'userdata-docdb',
    end_user_id: 'user_001',
    requests: 23,
    duration_p95_ms: 890,
    bytes_in: 1024000,
    bytes_out: 256000,
  },
  {
    id: 'usage_005',
    time_bucket: '2026-01-28 13:00',
    workspace_id: 'ws_001',
    project_id: 'proj_001',
    resource_type: 'userdata-vectordb',
    end_user_id: 'user_001',
    requests: 15,
    duration_p95_ms: 650,
    bytes_in: 512000,
    bytes_out: 128000,
  },
  {
    id: 'usage_006',
    time_bucket: '2026-01-28 14:00',
    workspace_id: 'ws_001',
    project_id: 'proj_001',
    resource_type: 'userdata-storage',
    end_user_id: 'user_001',
    requests: 8,
    duration_p95_ms: 1200,
    bytes_in: 2048000,
    bytes_out: 0,
  },
  {
    id: 'usage_007',
    time_bucket: '2026-01-27 16:00',
    workspace_id: 'ws_001',
    project_id: 'proj_001',
    resource_type: 'endpoints',
    resource_id: 'endpoint_001',
    end_user_id: 'user_001',
    requests: 178,
    duration_p95_ms: 2300,
    bytes_in: 320000,
    bytes_out: 6500000,
    tokens: 156000,
  },
];

// Aggregated KPI data for overview
export const usageKPI = {
  requests_today: 4523,
  errors_today: 23,
  tokens_today: 2456000,
  userdata_bytes: 12580000,
  requests_yesterday: 3890,
  errors_yesterday: 18,
};
