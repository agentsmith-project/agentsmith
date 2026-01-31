/**
 * Member Fixtures
 *
 * Mock member and user data for development and testing.
 */

import type { ProjectMembership } from '@/lib/api/types';

export interface Member {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  status: 'active' | 'blocked' | 'removed';
  created_at: string;
}

export interface JoinRequest {
  id: string;
  project_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
}

export const memberFixtures: Member[] = [
  {
    id: 'user_001',
    email: 'alice@example.com',
    name: 'Alice Chen',
    avatar: 'AC',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'user_002',
    email: 'bob.smith@example.com',
    name: 'Bob Smith',
    avatar: 'BS',
    status: 'active',
    created_at: '2026-01-05T00:00:00Z',
  },
  {
    id: 'user_003',
    email: 'charlie@example.com',
    name: 'Charlie Wilson',
    avatar: 'CW',
    status: 'active',
    created_at: '2026-01-10T00:00:00Z',
  },
  {
    id: 'user_004',
    email: 'diana@example.com',
    name: 'Diana Martinez',
    avatar: 'DM',
    status: 'active',
    created_at: '2026-01-12T00:00:00Z',
  },
  {
    id: 'user_005',
    email: 'eve@example.com',
    name: 'Eve Johnson',
    status: 'blocked',
    created_at: '2026-01-08T00:00:00Z',
  },
];

export const memberProjectMembershipFixtures: ProjectMembership[] = [
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
    permissions: ['project:read', 'project:agent:create', 'project:agent:manage', 'project:endpoint:create'],
    status: 'active',
    joined_at: '2026-01-16T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_003',
    role: 'developer',
    permissions: ['project:read', 'project:agent:create', 'project:chat:use'],
    status: 'active',
    joined_at: '2026-01-17T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_004',
    role: 'user',
    permissions: ['project:read', 'project:chat:use'],
    status: 'active',
    joined_at: '2026-01-18T10:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_005',
    role: 'user',
    permissions: ['project:read', 'project:chat:use'],
    status: 'blocked',
    joined_at: '2026-01-10T10:00:00Z',
  },
  {
    project_id: 'proj_002',
    user_id: 'user_001',
    role: 'owner',
    permissions: ['project:*'],
    status: 'active',
    joined_at: '2026-01-10T09:00:00Z',
  },
  {
    project_id: 'proj_002',
    user_id: 'user_003',
    role: 'admin',
    permissions: ['project:read', 'project:agent:create', 'project:agent:manage'],
    status: 'active',
    joined_at: '2026-01-12T09:00:00Z',
  },
];

export const joinRequestFixtures: JoinRequest[] = [
  {
    id: 'join_001',
    project_id: 'proj_001',
    user_id: 'user_006',
    user_email: 'frank@example.com',
    user_name: 'Frank Miller',
    reason: 'I would like to contribute to the AI assistant project',
    status: 'pending',
    requested_at: '2026-01-27T10:00:00Z',
  },
  {
    id: 'join_002',
    project_id: 'proj_001',
    user_id: 'user_007',
    user_email: 'grace@example.com',
    user_name: 'Grace Lee',
    reason: 'Interested in testing the chatbot features',
    status: 'pending',
    requested_at: '2026-01-28T14:30:00Z',
  },
  {
    id: 'join_003',
    project_id: 'proj_001',
    user_id: 'user_004',
    user_email: 'diana@example.com',
    user_name: 'Diana Martinez',
    reason: 'Would like to join the project',
    status: 'approved',
    requested_at: '2026-01-15T09:00:00Z',
    reviewed_at: '2026-01-15T14:00:00Z',
    reviewed_by: 'user_001',
  },
  {
    id: 'join_004',
    project_id: 'proj_001',
    user_id: 'user_008',
    user_email: 'henry@example.com',
    user_name: 'Henry Zhang',
    reason: 'Request access',
    status: 'rejected',
    requested_at: '2026-01-20T10:00:00Z',
    reviewed_at: '2026-01-21T09:00:00Z',
    reviewed_by: 'user_001',
  },
];
