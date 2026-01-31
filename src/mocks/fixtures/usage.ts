/**
 * Usage Statistics Fixtures
 *
 * Mock usage record data for development and testing.
 */

import type { UsageRecord } from '@/lib/api/types';

export const usageRecordFixtures: UsageRecord[] = [
  // Today's hourly records
  {
    time_bucket: '2026-01-28T14:00:00Z',
    resource_type: 'endpoint',
    resource_id: 'endpoint_001',
    requests: 145,
    duration_p95_ms: 2100,
    bytes_in: 256000,
    bytes_out: 5120000,
    tokens: 125000,
  },
  {
    time_bucket: '2026-01-28T13:00:00Z',
    resource_type: 'endpoint',
    resource_id: 'endpoint_001',
    requests: 132,
    duration_p95_ms: 1950,
    bytes_in: 235000,
    bytes_out: 4890000,
    tokens: 118000,
  },
  {
    time_bucket: '2026-01-28T12:00:00Z',
    resource_type: 'endpoint',
    resource_id: 'endpoint_002',
    requests: 89,
    duration_p95_ms: 3200,
    bytes_in: 180000,
    bytes_out: 4200000,
    tokens: 95000,
  },
  // Agent usage
  {
    time_bucket: '2026-01-28T14:00:00Z',
    resource_type: 'agent',
    resource_id: 'agent_001',
    agent_id: 'agent_001',
    requests: 67,
    duration_p95_ms: 4500,
    tokens: 89000,
  },
  {
    time_bucket: '2026-01-28T13:00:00Z',
    resource_type: 'agent',
    resource_id: 'agent_001',
    agent_id: 'agent_001',
    requests: 58,
    duration_p95_ms: 4200,
    tokens: 78000,
  },
  // UserData (source files)
  {
    time_bucket: '2026-01-28T14:00:00Z',
    resource_type: 'userdata',
    resource_id: 'ud-proj001-docs',
    requests: 23,
    duration_p95_ms: 890,
    bytes_in: 1024000,
    bytes_out: 256000,
  },
  // Previous day records
  {
    time_bucket: '2026-01-27T16:00:00Z',
    resource_type: 'endpoint',
    resource_id: 'endpoint_001',
    requests: 178,
    duration_p95_ms: 2300,
    bytes_in: 320000,
    bytes_out: 6500000,
    tokens: 156000,
  },
  {
    time_bucket: '2026-01-27T15:00:00Z',
    resource_type: 'endpoint',
    resource_id: 'endpoint_003',
    requests: 45,
    duration_p95_ms: 5600,
    bytes_in: 89000,
    bytes_out: 2100000,
    tokens: 45000,
  },
  // Error records
  {
    time_bucket: '2026-01-28T14:00:00Z',
    resource_type: 'endpoint',
    resource_id: 'endpoint_002',
    requests: 3,
    duration_p95_ms: undefined,
    bytes_in: 0,
    bytes_out: 0,
    tokens: 0,
  },
];

// Aggregated KPI data for overview
export const usageKPI = {
  total_requests: 4523,
  total_errors: 23,
  total_tokens: 2456000,
  total_bytes_in: 12580000,
  total_bytes_out: 289500000,
  avg_duration_p95_ms: 2850,
  active_agents: 4,
  online_agents: 2,
  queued_turns: 12,
  running_turns: 5,
};
