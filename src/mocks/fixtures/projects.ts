/**
 * Project Fixtures
 *
 * Mock project data for development and testing.
 */

import type { Project, ProjectMembership } from '@/lib/api/types';
import { GROUP_TEMPLATES } from '@/lib/constants/permissions';
import { PROJECT_BUILT_IN_GROUP_IDS, PROJECT_BUILT_IN_TEMPLATE_IDS } from '@/lib/governance/member-groups';

const defaultGovernance = {
  limits: {
    endpoint: {
      daily_token_limit: 200000,
    },
    source_library: {
      max_total_files: 2000,
      max_file_size_bytes: 104857600,
    },
    agent: {
      max_concurrency: 4,
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
    execution_preferences_json: {},
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
    execution_preferences_json: {},
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
    execution_preferences_json: {},
    limits_json: {},
    created_at: '2026-01-18T08:00:00Z',
    updated_at: '2026-01-28T16:45:00Z',
  },
];

export const projectMembershipFixtures: ProjectMembership[] = [
  // proj_001 members
  {
    project_id: 'proj_001',
    user_id: 'user_001',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.owner,
      name: 'Project owner',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
      built_in: true,
      system_key: 'owner',
    }],
    permissions: [...GROUP_TEMPLATES.owner],
    status: 'active',
    joined_at: '2026-01-15T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_002',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.admins,
      name: 'Project admins',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.admin,
      built_in: true,
      system_key: 'admins',
    }],
    permissions: [...GROUP_TEMPLATES.admin],
    status: 'active',
    joined_at: '2026-01-16T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_003',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.members,
      name: 'Project members',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.member,
      built_in: true,
      system_key: 'members',
    }],
    permissions: [...GROUP_TEMPLATES.user],
    status: 'active',
    joined_at: '2026-01-17T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_004',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.members,
      name: 'Project members',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.member,
      built_in: true,
      system_key: 'members',
    }],
    permissions: [...GROUP_TEMPLATES.user],
    status: 'active',
    joined_at: '2026-01-18T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_005',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.members,
      name: 'Project members',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.member,
      built_in: true,
      system_key: 'members',
    }],
    permissions: [...GROUP_TEMPLATES.user],
    status: 'removed',
    joined_at: '2026-01-08T10:00:00Z',
  },
  // proj_002 members
  {
    project_id: 'proj_002',
    user_id: 'user_001',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.owner,
      name: 'Project owner',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
      built_in: true,
      system_key: 'owner',
    }],
    permissions: [...GROUP_TEMPLATES.owner],
    status: 'active',
    joined_at: '2026-01-10T09:00:00Z',
  },
  {
    project_id: 'proj_002',
    user_id: 'user_003',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.admins,
      name: 'Project admins',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.admin,
      built_in: true,
      system_key: 'admins',
    }],
    permissions: [...GROUP_TEMPLATES.admin],
    status: 'active',
    joined_at: '2026-01-12T09:00:00Z',
  },
];

// Mock current user ID for development
export const CURRENT_USER_ID = 'user_001';
