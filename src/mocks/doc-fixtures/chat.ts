export type DocChatSession = {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  starred?: boolean;
  pinned?: boolean;
  model?: string;
  endpoint_id?: string;
};

export type DocChatMessage = {
  id: string;
  session_id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  created_at: string;
  parent_id?: string | null;
};

export const docChatSessions: DocChatSession[] = [
  {
    id: 'chat_doc_001',
    project_id: 'proj_001',
    user_id: 'user_001',
    title: '分析近 7 天 GLM-5 调用波动',
    model: 'GLM-5',
    endpoint_id: 'endpoint_001',
    pinned: true,
    starred: true,
    created_at: '2026-03-17T08:00:00Z',
    updated_at: '2026-03-17T09:00:00Z',
  },
  {
    id: 'chat_doc_002',
    project_id: 'proj_001',
    user_id: 'user_001',
    title: '整理审计日报行动项',
    model: 'claude-3-7-sonnet',
    endpoint_id: 'endpoint_002',
    created_at: '2026-03-16T14:00:00Z',
    updated_at: '2026-03-16T14:25:00Z',
  },
];

export const docChatMessages: DocChatMessage[] = [
  {
    id: 'chat_doc_msg_001',
    session_id: 'chat_doc_001',
    role: 'system',
    content: '你是企业级 AI 运营治理助手，回答要结构化、克制、便于直接复用到日报和白皮书。',
    created_at: '2026-03-17T08:00:00Z',
  },
  {
    id: 'chat_doc_msg_002',
    session_id: 'chat_doc_001',
    role: 'user',
    content: '请分析最近 7 天 GLM-5 endpoint 调用波动，重点看请求量、429 和费用变化。',
    created_at: '2026-03-17T08:01:00Z',
  },
  {
    id: 'chat_doc_msg_003',
    session_id: 'chat_doc_001',
    role: 'assistant',
    content: '初步结论：\\n\\n1. 请求量在周一和周三出现两个峰值，主因是 Notebook 批处理任务集中执行。\\n2. 429 主要集中在 10:00-11:00 与 15:00-16:00 两个窗口，和外部 codex runner 的并发任务有关。\\n3. 费用上升与长上下文 Notebook 任务相关，单次平均 token 消耗比聊天场景高约 2.3 倍。\\n\\n建议优先把批处理任务路由到 Claude 复杂推理 endpoint，GLM-5 保留给交互式对话。 ',
    created_at: '2026-03-17T08:01:20Z',
  },
  {
    id: 'chat_doc_msg_004',
    session_id: 'chat_doc_001',
    role: 'user',
    content: '把结论整理成给管理员看的行动项，控制在 4 条以内。',
    created_at: '2026-03-17T08:02:00Z',
  },
  {
    id: 'chat_doc_msg_005',
    session_id: 'chat_doc_001',
    role: 'assistant',
    content: '建议行动项：\\n\\n1. 为 GLM-5 设置更严格的工作时段限流，并把 Notebook 批处理默认切到 Claude 复杂推理。\\n2. 对运营审计助手增加队列并发上限，减少同一时间窗口的集中放量。\\n3. 在 Usage 页面增加按 endpoint 的 5 小时趋势检查，作为每日巡检固定动作。\\n4. 对高成本 Notebook 模板补充审批要求，避免成员直接执行超长上下文任务。',
    created_at: '2026-03-17T08:02:25Z',
  },
  {
    id: 'chat_doc_msg_006',
    session_id: 'chat_doc_002',
    role: 'user',
    content: '帮我整理今天需要跟进的审计异常。',
    created_at: '2026-03-16T14:00:00Z',
  },
  {
    id: 'chat_doc_msg_007',
    session_id: 'chat_doc_002',
    role: 'assistant',
    content: '今天优先关注 3 类异常：\\n\\n- Claude endpoint 在 14:00 后出现连续 429\\n- 两个成员在未审批情况下创建了高成本 Notebook 任务\\n- 文件库“运营周报文件库”有一次大文件批量删除操作，需要人工确认是否合规',
    created_at: '2026-03-16T14:00:18Z',
  },
];

