import type { Project, Credential, Endpoint, AgentRunner } from '@/lib/api/types';
import type { Member, JoinRequest } from '../fixtures/members';
import type { FileLibrary } from '@/lib/api/types';
import { PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS } from '@/lib/constants/permissions';
import { PROJECT_BUILT_IN_GROUP_IDS, PROJECT_BUILT_IN_TEMPLATE_IDS } from '@/lib/governance/member-groups';
import { agentRunnerActions } from '../fixtures/agent-runners';

export const docWorkspaceFixtures = [
  {
    id: 'ws_default',
    name: '智能体运营中心',
    created_at: '2026-03-01T08:00:00Z',
    updated_at: '2026-03-17T08:00:00Z',
  },
];

export const docProjectFixtures: Project[] = [
  {
    id: 'proj_001',
    workspace_id: 'ws_default',
    name: '企业级 AI 运营治理',
    description: '用于统一管理 endpoint、Agent 任务、文件库、Agent Runners 与审计用量的示例项目。',
    visibility: 'private',
    join_policy: 'approval_required',
    owner_id: 'user_001',
    status: 'active',
    created_at: '2026-03-05T09:00:00Z',
    updated_at: '2026-03-17T09:30:00Z',
  },
  {
    id: 'proj_002',
    workspace_id: 'ws_default',
    name: '客服知识助手',
    description: '围绕工单问答、知识库同步和质量追踪的客服智能体项目。',
    visibility: 'private',
    join_policy: 'approval_required',
    owner_id: 'user_001',
    status: 'active',
    created_at: '2026-02-20T10:00:00Z',
    updated_at: '2026-03-16T14:00:00Z',
  },
];

export const docProjectMembershipFixtures = [
  {
    project_id: 'proj_001',
    user_id: 'user_001',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.owner,
      name: '项目所有者',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
      built_in: true,
      system_key: 'owner',
    }],
    permissions: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.owner],
    status: 'active',
    joined_at: '2026-03-05T09:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_002',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.admins,
      name: '项目管理员',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.admin,
      built_in: true,
      system_key: 'admins',
    }],
    permissions: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.admin],
    status: 'active',
    joined_at: '2026-03-06T09:00:00Z',
  },
  {
    project_id: 'proj_001',
    user_id: 'user_003',
    groups: [{
      id: PROJECT_BUILT_IN_GROUP_IDS.members,
      name: '项目成员',
      permission_template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.member,
      built_in: true,
      system_key: 'members',
    }],
    permissions: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.member],
    status: 'active',
    joined_at: '2026-03-07T09:00:00Z',
  },
];

export const docMemberFixtures: Member[] = [
  {
    id: 'user_001',
    email: 'lin.xu@example.com',
    name: '许琳',
    avatar: '许',
    status: 'active',
    created_at: '2026-01-08T00:00:00Z',
  },
  {
    id: 'user_002',
    email: 'zhou.yan@example.com',
    name: '周岩',
    avatar: '周',
    status: 'active',
    created_at: '2026-01-10T00:00:00Z',
  },
  {
    id: 'user_003',
    email: 'guo.qing@example.com',
    name: '郭青',
    avatar: '郭',
    status: 'active',
    created_at: '2026-01-12T00:00:00Z',
  },
  {
    id: 'user_004',
    email: 'he.miao@example.com',
    name: '何淼',
    avatar: '何',
    status: 'active',
    created_at: '2026-01-16T00:00:00Z',
  },
];

export const docJoinRequestFixtures: JoinRequest[] = [
  {
    id: 'join_doc_001',
    project_id: 'proj_001',
    user_id: 'user_008',
    user_email: 'li.na@example.com',
    user_name: '李娜',
    reason: '需要参与 endpoint 治理策略和审计日报的维护工作。',
    status: 'pending',
    requested_at: '2026-03-16T16:20:00Z',
  },
];

export const docCredentialFixtures: Credential[] = [
  {
    id: 'cred_001',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'placeholder-model 生产 API Key',
    type: 'api_key',
    fingerprint: '••••••••••••plh1',
    created_at: '2026-03-01T09:00:00Z',
    last_rotated_at: '2026-03-15T10:00:00Z',
  },
  {
    id: 'cred_002',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Claude 推理网关密钥',
    type: 'api_key',
    fingerprint: '••••••••••••cld5',
    created_at: '2026-03-03T11:00:00Z',
  },
];

export const docEndpointFixtures: Endpoint[] = [
  {
    id: 'endpoint_001',
    project_id: 'proj_001',
    name: 'placeholder-model 主生产',
    description: '用于对话和 Agent 任务的主生产模型入口。',
    model: 'placeholder-model',
    type: 'custom',
    provider_family: 'custom',
    upstream_protocol: 'anthropic_messages',
    base_url: 'https://anthropic-compatible.provider.example',
    status: 'active',
    credential_ref: 'cred_001',
    limits: {
      max_requests_per_minute: 120,
      max_requests_per_day: 8000,
      max_tokens_per_day: 6000000,
      timeout_seconds: 180,
    },
    created_at: '2026-03-01T09:20:00Z',
    updated_at: '2026-03-17T08:20:00Z',
  },
  {
    id: 'endpoint_002',
    project_id: 'proj_001',
    name: 'Claude 复杂推理',
    description: '用于长上下文分析与复杂推理的备选模型入口。',
    model: 'claude-3-7-sonnet',
    type: 'catalog',
    provider_family: 'anthropic',
    upstream_protocol: 'anthropic_messages',
    base_url: 'https://api.anthropic.com/v1',
    status: 'active',
    credential_ref: 'cred_002',
    limits: {
      max_requests_per_minute: 60,
      max_requests_per_day: 4000,
      max_tokens_per_day: 4000000,
      timeout_seconds: 240,
    },
    created_at: '2026-03-02T10:00:00Z',
    updated_at: '2026-03-17T08:30:00Z',
  },
];

export const docAgentRunnerFixtures: AgentRunner[] = [
  {
    id: 'agent_001',
    project_id: 'proj_001',
    name: '运营审计助手',
    description: '通过托管 Runner 执行审计分析、Agent 任务调度和知识问答。',
    kind: 'system_managed',
    source: 'system',
    read_only: true,
    is_default: true,
    default_endpoint_id: 'ep_deepseek_chat',
    status: 'ready',
    capabilities: {
      task_execution: true,
      terminal: true,
      artifacts: true,
      file_inputs: true,
    },
    diagnostics: {
      presence: 'managed',
      queue_depth: 2,
    },
    actions: agentRunnerActions('system_managed'),
    created_at: '2026-03-02T09:00:00Z',
    updated_at: '2026-03-17T08:45:00Z',
  },
  {
    id: 'agent_dev_001',
    project_id: 'proj_001',
    name: '本地开发 Runner',
    description: '用于开发者本地连接、Test connection 与 runner test task 检查。',
    kind: 'developer',
    source: 'developer',
    read_only: false,
    is_default: false,
    status: 'connected',
    capabilities: {
      task_execution: true,
      terminal: true,
      artifacts: true,
      file_inputs: true,
    },
    diagnostics: {
      presence: 'online',
      last_pong_at: '2026-03-17T08:44:00Z',
    },
    actions: agentRunnerActions('developer'),
    created_at: '2026-03-17T08:00:00Z',
    updated_at: '2026-03-17T08:44:00Z',
  },
];

export const docFileLibraries: FileLibrary[] = [
  {
    id: 'lib_shared_default',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: '运营周报文件库',
    description: '沉淀运营周报、审计日报和巡检脚本输出。',
    visibility: 'shared',
    source: 'agent_task_files',
    file_library_home_segment: 'task-home-ops-weekly',
    status: 'ready',
    storage_status: 'available',
    storage_next_action: null,
    task_home_binding_status: 'unbound',
    bound_task_visible: false,
    created_by_user_id: 'user_001',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-17T08:50:00Z',
  },
  {
    id: 'lib_policy_rules',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: '治理策略模板',
    description: '保存 endpoint 限额模板、资源策略和治理说明书。',
    visibility: 'shared',
    source: 'agent_task_files',
    file_library_home_segment: 'task-home-policy-templates',
    status: 'ready',
    storage_status: 'available',
    storage_next_action: null,
    task_home_binding_status: 'unbound',
    bound_task_visible: false,
    created_by_user_id: 'user_001',
    created_at: '2026-03-03T11:00:00Z',
    updated_at: '2026-03-17T08:55:00Z',
  },
];
