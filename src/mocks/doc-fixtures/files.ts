type DocObjectRow =
  | { kind: 'prefix'; prefix: string; name: string }
  | {
      kind: 'object';
      key: string;
      name: string;
      size_bytes: number;
      content_type: string;
      last_modified: string;
      content?: string;
    };

const now = '2026-03-17T09:00:00Z';

export const docObjectDbByLibraryId: Record<string, DocObjectRow[]> = {
  lib_shared_default: [
    { kind: 'prefix', prefix: '周报/', name: '周报' },
    { kind: 'prefix', prefix: '巡检截图/', name: '巡检截图' },
    {
      kind: 'object',
      key: 'README.md',
      name: 'README.md',
      size_bytes: 3220,
      content_type: 'text/markdown',
      last_modified: now,
      content: '# 运营周报文件库\n\n用于沉淀巡检周报、用量摘要、截图与导出的任务产物。',
    },
    {
      kind: 'object',
      key: '周报/2026-W11/usage-summary.md',
      name: 'usage-summary.md',
      size_bytes: 18420,
      content_type: 'text/markdown',
      last_modified: now,
      content: '## 2026 W11 用量摘要\n\n- placeholder-model 请求量 18,420\n- Claude 复杂推理请求量 4,180\n- 高峰时段 10:00-11:00 / 15:00-16:00',
    },
    {
      kind: 'object',
      key: '巡检截图/endpoint-usage-overview.png',
      name: 'endpoint-usage-overview.png',
      size_bytes: 268420,
      content_type: 'image/png',
      last_modified: now,
    },
  ],
  lib_policy_rules: [
    { kind: 'prefix', prefix: 'templates/', name: 'templates' },
    {
      kind: 'object',
      key: 'templates/endpoint-policy-baseline.md',
      name: 'endpoint-policy-baseline.md',
      size_bytes: 9231,
      content_type: 'text/markdown',
      last_modified: now,
      content: '## Endpoint 默认治理基线\n\n- 每分钟请求上限\n- 每 5 小时请求上限\n- 每日费用上限\n- 指定成员白名单',
    },
  ],
};
