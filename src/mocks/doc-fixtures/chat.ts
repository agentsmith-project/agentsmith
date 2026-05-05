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
    title: '北美消费电子市场量化诊断',
    model: 'placeholder-model',
    endpoint_id: 'endpoint_001',
    pinned: true,
    starred: true,
    created_at: '2026-03-17T08:00:00Z',
    updated_at: '2026-03-17T09:12:00Z',
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
    content: '你是企业市场与投研分析助手。回答要结构化、保留关键数字，并能直接转化为经营结论和行动建议。',
    created_at: '2026-03-17T08:00:00Z',
  },
  {
    id: 'chat_doc_msg_002',
    session_id: 'chat_doc_001',
    role: 'user',
    content: '请基于最近 12 周的销量、折扣率、搜索热度和广告投放数据，分析北美消费电子市场的短期景气度。重点看智能耳机、游戏掌机和居家显示设备三条线。',
    created_at: '2026-03-17T08:01:00Z',
  },
  {
    id: 'chat_doc_msg_003',
    session_id: 'chat_doc_001',
    role: 'assistant',
    content: '初步量化结论如下：\n\n1. 智能耳机：销量周均环比 +6.8%，但折扣率从 11% 抬升到 15%，说明增长更多来自促销拉动，真实需求弹性一般。\n2. 游戏掌机：搜索热度 4 周均值提升 18%，销量同步提升 9%，且广告投入 ROI 维持在 1.7 左右，是三条线里景气度最强的一类。\n3. 居家显示设备：销量下降 4.5%，但客单价提升 6.2%，说明市场正在往高端 SKU 集中，适合减少低毛利型号的备货。\n\n如果要给经营层一个一句话判断：当前市场不是全面回暖，而是“游戏掌机明显走强、耳机靠促销维持、显示设备在做结构升级”。',
    created_at: '2026-03-17T08:01:28Z',
  },
  {
    id: 'chat_doc_msg_004',
    session_id: 'chat_doc_001',
    role: 'user',
    content: '继续往前走一步：帮我做一个 3 档预算的投放建议，分别给保守、基准、进攻三个方案，每个方案说明资源倾斜和主要风险。',
    created_at: '2026-03-17T08:04:00Z',
  },
  {
    id: 'chat_doc_msg_005',
    session_id: 'chat_doc_001',
    role: 'assistant',
    content: '建议方案如下：\n\n一、保守方案（预算 100）\n- 50 投向游戏掌机关键词广告\n- 30 投向智能耳机会员复购召回\n- 20 用于显示设备高客单价再营销\n- 风险：增长弹性有限，难以抢占短期增量流量\n\n二、基准方案（预算 160）\n- 80 投向游戏掌机新品种草和转化广告\n- 45 投向耳机品类词 + 内容评测合作\n- 35 投向显示设备高端 SKU 联合投放\n- 风险：耳机品类若促销收缩，投放转化会回落\n\n三、进攻方案（预算 240）\n- 120 投向游戏掌机，配合达人内容和预售转化链路\n- 70 投向耳机大促前预热与老客裂变\n- 50 投向显示设备办公场景内容营销\n- 风险：若 2 周内需求没有持续放大，库存和投放回报会同步承压\n\n建议默认采用基准方案，并设置“游戏掌机周转率低于 1.15 时自动降档”的风控阈值。',
    created_at: '2026-03-17T08:04:36Z',
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
    content: '今天优先关注 3 类异常：\n\n- Claude endpoint 在 14:00 后出现连续 429\n- 两个成员在未审批情况下创建了高成本 Agent 任务\n- 文件库“运营周报文件库”有一次大文件批量删除操作，需要人工确认是否合规',
    created_at: '2026-03-16T14:00:18Z',
  },
];
