/**
 * Project Fixtures
 *
 * Mock project data for development and testing.
 * Uses ROLE_TEMPLATES for permissions per design (v1 no wildcards).
 */

import type { Project, ProjectMembership } from '@/lib/api/types';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';

const defaultGovernance = {
  quotas: {
    userdata: {
      storage: {
        bytes_per_end_user: 2147483648,
        objects_per_end_user: 20000,
      },
      docdb: {
        max_collections_per_scope: 50,
        max_document_bytes: 1048576,
        query_timeout_ms: 2000,
        page_size_max: 100,
      },
      vectordb: {
        max_indexes_per_scope: 50,
        top_k_max: 200,
        upsert_records_max: 500,
      },
    },
    endpoint: {
      requests_per_day_per_end_user: 10000,
      requests_per_min_per_end_user: 120,
    },
  },
};

export const projectFixtures: Project[] = [
  {
    id: 'proj_001',
    workspace_id: 'ws_default',
    name: 'AI Assistant Project',
    description: 'A project for AI-powered assistants and chatbots',
    visibility: 'public',
    join_policy: 'approval_required',
    owner_id: 'user_001',
    status: 'active',
    governance_json: defaultGovernance,
    runtime_preferences_json: {},
    limits_json: {},
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-25T14:20:00Z',
  },
  {
    id: 'proj_002',
    workspace_id: 'ws_default',
    name: 'Research Project',
    description: 'Private research project for LLM experiments',
    visibility: 'private',
    join_policy: 'approval_required',
    owner_id: 'user_001',
    status: 'active',
    governance_json: defaultGovernance,
    runtime_preferences_json: {},
    limits_json: {},
    created_at: '2026-01-10T09:00:00Z',
    updated_at: '2026-01-20T11:30:00Z',
  },
  {
    id: 'proj_003',
    workspace_id: 'ws_default',
    name: 'Customer Support Bot',
    description: 'Automated customer service agent',
    visibility: 'public',
    join_policy: 'open',
    owner_id: 'user_002',
    status: 'active',
    governance_json: defaultGovernance,
    runtime_preferences_json: {},
    limits_json: {},
    created_at: '2026-01-18T08:00:00Z',
    updated_at: '2026-01-28T16:45:00Z',
  },
];

export const projectMembershipFixtures: ProjectMembership[] = [
  {
    project_id: 'proj_001',
    user_id: 'user_001',
    role: 'owner',
    permissions: [...ROLE_TEMPLATES.owner],
    status: 'active',
    joined_at: '2026-01-15T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_002',
    role: 'admin',
    permissions: [...ROLE_TEMPLATES.admin],
    status: 'active',
    joined_at: '2026-01-16T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_003',
    role: 'developer',
    permissions: [...ROLE_TEMPLATES.developer],
    status: 'active',
    joined_at: '2026-01-17T10:00:00Z',
  },
  {
    project_id: 'proj_002',
    user_id: 'user_001',
    role: 'owner',
    permissions: [...ROLE_TEMPLATES.owner],
    status: 'active',
    joined_at: '2026-01-10T09:00:00Z',
  },
];
