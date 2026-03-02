# M4 Enterprise Ops Control Plane GA Work Package Plan v1

更新时间：2026-03-03
状态：`draft`

前置文档：

1. `docs/plans/organization-governance-rollup-enterprise-ops-console-plan-v1.md` (已完成的 M3 基线)
2. `docs/design/agentsmith-product-engineering-governance-methodology-v1.md`
3. `docs/项目宪法.md`

---

## 1. 本计划的作用

M4 是 Enterprise Ops Control Plane 的 **GA (General Availability) 里程碑**，目标是将已验证的组织级治理能力从 "可用" 提升到 "生产就绪"。

在 M3 已完成的基线上，M4 专注于：

1. **增强组织级治理总控台** - 从展示升级为决策中枢
2. **完善 Evidence 链路** - 确保每项治理决策都有可追溯证据
3. **强化发布治理** - 组织级证据正式进入发布门禁
4. **建立持续质量护栏** - 防止回滚与回归

---

## 2. 现有基础设施分析

### 已存在的组织级治理能力（M3 交付）

#### 2.1 核心模块

| 模块 | 文件路径 | 状态 |
|------|----------|------|
| 组织治理汇总 Hook | `src/lib/hooks/use-organization-governance-rollup.ts` | ✅ 完成 |
| 组织动作 Store | `src/lib/stores/organization-actions-store.ts` | ✅ 完成 |
| 组织动作 API | `src/lib/api/endpoints/organization-actions.ts` | ✅ 完成 |
| 治理下钻上下文 | `src/lib/governance-drilldown-context.ts` | ✅ 完成 |
| 治理证据工具 | `src/lib/governance-evidence.ts` | ✅ 完成 |
| 治理下钻 Banner | `src/components/ui/GovernanceDrilldownBanner.tsx` | ✅ 完成 |
| 组织总览页 | `src/app/[locale]/workspaces/overview/page.tsx` | ✅ 完成 |

#### 2.2 数据流

```
Organization Governance Rollup
    ↓
┌─────────────────────────────────────────┐
│  Workspace Risk Ranking                 │
│  + org_posture_summary                  │
│  + actions_queue                        │
│  + attention_feed                       │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  Governance Drilldown Context           │
│  + gov_from / gov_kind                  │
│  + gov_workspace_id / gov_project_id    │
│  + evidence metrics (signals/blocked)   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  Evidence Bridge                        │
│  + runtime/usage/run/escalation data    │
│  + trace context (incident/escalation)  │
│  + filter pass-through (audit/usage)    │
└─────────────────────────────────────────┘
```

#### 2.3 现有限制与差距

| 类别 | 限制 | M4 目标 |
|------|------|---------|
| **风险排序** | 仅基于静态信号，无趋势预测 | 引入时间序列分析与风险趋势 |
| **动作执行** | 状态同步为主，缺少原子化执行 | 支持跨 workspace 批量动作 |
| **Evidence** | 证据链存在但解释性不足 | 每项 blocker 都有可追溯证据 |
| **发布门禁** | 组织证据已接入但非 hard fail | 实现 hard fail 机制 |
| **质量护栏** | E2E 覆盖但无回归防护 | 防复发测试清单 |

---

## 3. M4 工作包拆分

### WP-07: 组织级治理总控台增强 (P0)

**目标**：将组织总览从"展示面板"升级为"决策中枢"

#### 3.1 风险排序与优先级队列优化

**现状**：
- `workspaceRanking` 基于 `riskScore` 排序
- 风险分由 `blockedCount * 10 + warningCount` 计算得出

**M4 增强**：
1. 引入 **趋势因子**（24h/7d/30d 风险分变化）
2. 引入 **爆发检测**（短时间内信号激增的 workspace）
3. 引入 **关联分析**（跨 workspace 的共同模式）

```typescript
interface WorkspaceRiskRanking {
  workspaceId: string;
  workspaceName: string;
  riskScore: number;
  riskTrend: 'improving' | 'stable' | 'deteriorating' | 'surging';
  riskVelocity: number;  // 风险变化速率
  burstDetected: boolean; // 是否检测到信号爆发
  relatedPatterns: string[]; // 关联模式（如 "quota_exceeded", "cost_overrun"）
}
```

**交付物**：
- [ ] `src/lib/hooks/use-organization-governance-rollup.ts` 扩展趋势计算
- [ ] `src/app/[locale]/workspaces/overview/page.tsx` 新增趋势标识
- [ ] 新增 `risk-trend-indicator` 组件（箭头+颜色）
- [ ] 新增 `burst-badge` 组件（爆发标识）

#### 3.2 企业动作队列可执行性

**现状**：
- 动作队列支持状态回写（pending/in-progress/completed/blocked）
- 但动作执行仍需跳转到各 workspace/project 页面

**M4 增强**：
1. 支持从总控台直接执行**高频动作**：
   - 调整 resource policy quota
   - 禁用/启用 endpoint
   - 移除过 scope member
2. 支持跨 workspace **批量执行**：
   - 批量更新相同 policy
   - 批量调整 member scope
3. 引入 **执行预览** 与 **确认机制**

```typescript
interface BatchActionPreview {
  actionType: 'update_policy' | 'adjust_scope' | 'toggle_endpoint';
  targetWorkspaceIds: string[];
  previewChanges: Array<{
    workspaceId: string;
    currentValue: unknown;
    newValue: unknown;
    impact: 'low' | 'medium' | 'high';
  }>;
  requiresConfirmation: boolean;
}
```

**交付物**：
- [ ] `src/lib/api/endpoints/organization-actions.ts` 新增批量执行端点
- [ ] `src/components/organization/BatchActionPreviewModal.tsx`
- [ ] `src/components/organization/BatchPolicyUpdateForm.tsx`
- [ ] E2E: 覆盖批量执行场景

#### 3.3 下钻到 workspace/project 执行点

**现状**：
- `GovernanceDrilldownBanner` 提供了基础下钻能力
- 但下钻后页面上下文可能丢失

**M4 增强**：
1. **深化 drill-down context**：
   - 增加 `gov_root_cause` 字段（根因分析）
   - 增加 `gov_suggested_remediation` 字段（建议修复动作）
2. **保持 context 传递**：
   - 确保 `resource-policy` / `audit` / `members` 页面正确解析 context
   - 支持 context 在多级导航后保持有效
3. **返回路径优化**：
   - 从任何下钻页面一键返回组织总览
   - 保持过滤器状态

**交付物**：
- [ ] `src/lib/governance-drilldown-context.ts` 扩展 context 类型
- [ ] `src/components/ui/GovernanceDrilldownBanner.tsx` 新增"返回总览"按钮
- [ ] E2E: 验证完整下钻链路

---

### WP-08: Evidence 链路完善 (P0)

**目标**：确保每项治理决策都有可追溯、可解释的证据

#### 4.1 Blocker/Warning 可解释性

**现状**：
- `GovernanceEvidenceFocus` 已支持 `quota` / `deny` / `cost` / `exposure` / `membership` 分类
- `GovernanceDrilldownBanner` 已显示证据计数

**M4 增强**：
1. **证据摘要生成**：
   ```typescript
   interface EvidenceSummary {
     focus: GovernanceEvidenceFocus;
     totalCount: number;
     topIncidents: Array<{
       incidentId: string;
       type: string;
       description: string;
       affectedEntities: string[];  // workspace/project/member
       firstSeenAt: string;
       lastOccurredAt: string;
     }>;
     suggestedActions: string[];
   }
   ```

2. **证据详情面板**：
   - 点击 evidence metrics 展开详情
   - 显示具体 incident 列表
   - 支持跳转到原始 incident 详情

**交付物**：
- [ ] `src/lib/governance-evidence.ts` 新增 `generateEvidenceSummary`
- [ ] `src/components/organization/EvidenceDetailPanel.tsx`
- [ ] `src/components/organization/EvidenceSummaryCard.tsx`

#### 4.2 Audit/Usage/Release 上下文透传

**现状**：
- drill-down query 已支持传递到 audit/usage 页面
- Audit 页面已支持 trace 引用匹配

**M4 增强**：
1. **统一过滤器协议**：
   ```typescript
   interface GovernanceFilterContext {
     gov_from: GovernanceDrilldownOrigin;
     gov_focus?: GovernanceEvidenceFocus;
     gov_time_range?: { start: string; end: string };
     gov_entity_filter?: { workspace_ids?: string[]; project_ids?: string[] };
   }
   ```

2. **上下文自动应用**：
   - 进入 audit/usage 页面时自动应用过滤器
   - 显示"来自组织治理"提示
   - 支持一键清除过滤器

**交付物**：
- [ ] `src/components/audit/AuditPageWithGovernanceContext.tsx`
- [ ] `src/components/usage/UsagePageWithGovernanceContext.tsx`
- [ ] E2E: 验证上下文透传与过滤器应用

#### 4.3 治理场景证据展示

**现状**：
- `classifyGovernanceEvidenceFocus` 已支持基础分类

**M4 增强**：
1. **场景化证据聚合**：
   - Cost 场景：聚合 billing/token usage 数据
   - Quota 场景：聚合 rate limit / resource policy 数据
   - Deny 场景：聚合 authorization failures 数据
   - Exposure 场景：聚合 public visibility / open access 数据

2. **证据可视化**：
   - 每个场景独立的 evidence panel
   - 时间序列图表（趋势）
   - Top contributors 排行

**交付物**：
- [ ] `src/components/organization/scenario-evidence/CostScenarioEvidence.tsx`
- [ ] `src/components/organization/scenario-evidence/QuotaScenarioEvidence.tsx`
- [ ] `src/components/organization/scenario-evidence/DenyScenarioEvidence.tsx`
- [ ] `src/components/organization/scenario-evidence/ExposureScenarioEvidence.tsx`

---

### WP-09: 发布治理强化 (P0)

**目标**：组织级证据正式进入发布门禁，实现 hard fail 机制

#### 5.1 组织级证据进入 Release Report

**现状**：
- `release:report` 已接入 `organization_governance_evidence`
- 但证据内容较为基础

**M4 增强**：
1. **扩展 Organization Governance Evidence Artifact**：
   ```typescript
   interface OrganizationGovernanceEvidenceArtifact {
     summary: {
       total_workspaces: number;
       blocked_workspaces: number;
       warning_workspaces: number;
       risk_score_average: number;
     };
     top_risk_workspaces: Array<{
       workspace_id: string;
       risk_score: number;
       blocked_count: number;
       warning_count: number;
     }>;
     blocker_incidents: Array<{
       incident_id: string;
       type: string;
       focus: GovernanceEvidenceFocus;
       description: string;
       affected_workspaces: string[];
     }>;
     evidence_traces: Array<{
       trace_id: string;
       source: 'runtime' | 'usage' | 'audit' | 'escalation';
       timestamp: string;
       metadata: Record<string, unknown>;
     }>;
   }
   ```

**交付物**：
- [ ] `scripts/release/generate-organization-governance-evidence.ts`
- [ ] 更新 `artifacts/release-runs/` 目录结构

#### 5.2 门禁 Hard Fail 机制

**现状**：
- release gate 已支持 organization governance 检查
- 但失败仅作为 warning，不阻断发布

**M4 增强**：
1. **配置化 Hard Fail 规则**：
   ```typescript
   interface OrganizationGovernanceHardFailRules {
     enabled: boolean;
     rules: Array<{
       name: string;
       condition: 'blocked_count_gt' | 'risk_score_gt' | 'incident_count_gt';
       threshold: number;
       severity: 'critical' | 'high';
     }>;
   }
   ```

2. **Gate 执行逻辑**：
   - 检查 organization governance evidence
   - 评估 hard fail 规则
   - 规则命中时返回 `GateResult.BLOCKED`
   - 提供详细的 blocker 报告

**交付物**：
- [ ] `scripts/gate/organization-governance-gate.ts`
- [ ] `scripts/release/verify-release.ts` 集成 hard fail

#### 5.3 证据化验收

**现状**：
- 组织治理验收依赖手工 demo

**M4 增强**：
1. **自动化验收流程**：
   ```bash
   # 组织治理 smoke test
   npm run test:organization-governance-smoke

   # 生成 evidence artifact
   npm run release:generate-org-governance-evidence

   # 验证 gate
   npm run gate:organization-governance
   ```

2. **E2E 场景覆盖**：
   - 组织总览加载与渲染
   - 下钻到具体 workspace
   - 证据详情查看
   - 动作执行与状态回写

**交付物**：
- [ ] `e2e/organization-governance-smoke.spec.ts`
- [ ] `scripts/release/organization-governance-release-checklist.md`

---

### WP-10: 持续质量护栏 (P1)

**目标**：建立防止回滚与回归的质量护栏

#### 6.1 PR 证据化模板

**目标**：每个 PR 都需要提供"治理影响评估"

**模板结构**：
```markdown
## Organization Governance Impact Assessment

### Risk Area
- [ ] Cost/Billing
- [ ] Resource Policy/Quota
- [ ] Access Control/Membership
- [ ] Release Readiness
- [ ] Other (specify)

### Changes
<!-- Describe what governance-related changes this PR introduces -->

### Evidence
<!-- Link to relevant incidents, escalations, or audit events -->

### Testing
- [ ] Unit tests added/updated
- [ ] E2E scenarios covered
- [ ] Manual testing checklist completed
```

**交付物**：
- [ ] `.github/PULL_REQUEST_TEMPLATE/with-governance-impact.md`
- [ ] `scripts/pr/validate-governance-impact.ts`

#### 6.2 防复发测试清单

**目标**：确保已修复的问题不会复发

**清单内容**：
```typescript
interface RegressionTestChecklist {
  category: 'governance' | 'evidence' | 'release';
  tests: Array<{
    id: string;
    description: string;
    incident_ref: string;  // 关联的原始 incident
    test_command: string;
    e2e_scenario?: string;
    must_pass_before_merge: boolean;
  }>;
}
```

**示例**：
```yaml
governance:
  - id: "REG-001"
    description: "Workspace risk score should not decrease without policy changes"
    incident_ref: "INC-2024-001"
    test_command: "npm run test:workspace-risk-score"
    must_pass_before_merge: true
  - id: "REG-002"
    description: "Drill-down context should preserve across navigation"
    incident_ref: "INC-2024-015"
    e2e_scenario: "e2e/governance-drilldown-context.spec.ts"
    must_pass_before_merge: true
```

**交付物**：
- [ ] `tests/regression/governance-regression-checklist.yml`
- [ ] `scripts/test/run-regression-check.ts`

#### 6.3 回归测试加固

**目标**：关键治理路径必须有回归测试保护

**关键路径**：
1. Organization Rollup 计算
2. Drilldown Context 序列化/反序列化
3. Evidence Bridge 聚合
4. Organization Actions 状态同步

**交付物**：
- [ ] `src/lib/__tests__/governance-regression.test.ts`
- [ ] `e2e/governance-regression.spec.ts`

---

## 4. 执行顺序

```
WP-07 → WP-08 → WP-09 → WP-10
  ↓        ↓        ↓        ↓
总控台   Evidence  Gate   质量护栏
增强     链路     强化
```

**并行机会**：
- WP-07.2 (企业动作队列) 可与 WP-08 并行
- WP-10 (质量护栏) 可与 WP-09 并行

---

## 5. 团队分工建议

| WP | 角色 | 估时 |
|----|------|------|
| WP-07 组织级治理总控台增强 | Frontend + Backend | 5-7 天 |
| WP-08 Evidence 链路完善 | Frontend + QA | 4-6 天 |
| WP-09 发布治理强化 | Backend + DevOps | 3-5 天 |
| WP-10 持续质量护栏 | QA + Tooling | 3-4 天 |

**总计**：15-22 天（取决于并行程度）

---

## 6. Gate 定义

### L0 Gate (WP 完成标准)

每个 WP 完成时需要满足：

- [ ] 代码审查通过（2人 approval）
- [ ] 单元测试覆盖率 > 80%
- [ ] E2E 场景覆盖核心路径
- [ ] Lint 通过，无 warning
- [ ] TypeScript 编译无错误
- [ ] 更新相关文档

### L1 Gate (M4 GA 标准)

M4 发布前需要满足：

- [ ] 所有 WP 完成并通过 L0 Gate
- [ ] 组织治理 smoke test 通过
- [ ] Release report 包含 org governance evidence
- [ ] Hard fail 规则验证通过（有意触发 blocker，验证 gate 阻断）
- [ ] 回归测试清单全部通过
- [ ] 性能测试：组织总览页加载 < 2s
- [ ] 安全测试：无新的权限泄漏

---

## 7. 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 后端 API 延迟 | WP-07/08 受阻 | 使用 Mock 数据并行开发 |
| E2E 测试不稳定 | WP-10 受阻 | 优先建立稳定的测试数据集 |
| 性能回归 | GA 延迟 | 每个 WP 完成时做性能基准测试 |
| 治理证据不足 | Gate 阻断 | 建立 evidence 补充机制（手工标注） |

---

## 8. 当前进展（2026-03-03）

### 已完成 (M3 基线)

1. ✅ 组织治理汇总 Hook
2. ✅ 组织动作 Store + API
3. ✅ 治理下钻上下文与 Banner
4. ✅ 组织总览页（workspace ranking + actions queue）
5. ✅ Evidence Bridge（runtime/usage/run/escalation）
6. ✅ Release smoke + evidence artifact

### M4 待启动

- [ ] WP-07: 风险趋势、批量动作、深化下钻
- [ ] WP-08: Evidence 可解释性、场景聚合
- [ ] WP-09: Hard fail 机制、证据化验收
- [ ] WP-10: PR 模板、回归测试清单
