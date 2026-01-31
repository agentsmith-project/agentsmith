/**
 * Project Fixtures
 *
 * Mock project data for development and testing.
 */

import type { Project, ProjectMembership } from '@/lib/api/types';

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
    created_at: '2026-01-18T08:00:00Z',
    updated_at: '2026-01-28T16:45:00Z',
  },
];

export const projectMembershipFixtures: ProjectMembership[] = [
  {
    project_id: 'proj_001',
    user_id: 'user_001',
    role: 'owner',
    permissions: ['project:*'],
    status: 'active',
    joined_at: '2026-01-15T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_002',
    role: 'admin',
    permissions: ['project:read', 'project:agent:create', 'project:agent:manage'],
    status: 'active',
    joined_at: '2026-01-16T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_003',
    role: 'developer',
    permissions: ['project:read', 'project:agent:create'],
    status: 'active',
    joined_at: '2026-01-17T10:00:00Z',
  },
  {
    project_id: 'proj_002',
    user_id: 'user_001',
    role: 'owner',
    permissions: ['project:*'],
    status: 'active',
    joined_at: '2026-01-10T09:00:00Z',
  },
];
