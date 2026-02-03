# MBOS Frontend - 改进路线图 v1

**日期**: 2026-02-03
**基于**: 架构评审报告 (ARCHITECTURE_REVIEW_2026-02-03.md)
**策略**: 全面均衡推进（稳定性 + 测试 + 功能）
**状态**: 设计阶段

---

## 执行摘要

本路线图针对 MBOS Frontend 的 P0/P1 技术债务，采用"全面均衡、最小批次"策略，将改进工作组织为 4 个独立的 Sprint（每个 1-2 周）。

### 核心原则

| 原则 | 说明 |
|------|------|
| **批次独立** | 每个 Sprint 可独立交付，失败不阻塞其他 Sprint |
| **风险隔离** | 使用 Git Worktree 隔离工作，主分支始终保持可部署 |
| **类型安全优先** | 修复所有 `as unknown as` 类型断言，添加运行时验证 |
| **测试驱动** | 先建立测试基础设施，再进行重构 |
| **Mock First** | 后端 API 未就绪时，先定义契约并用 Mock 实现过渡 |

### 优先级矩阵

```
高影响 × 高紧急  → Sprint 1（类型安全、测试基础设施）
高影响 × 低紧急  → Sprint 2-3（成员管理、权限深化）
低影响 × 高紧急  → Sprint 2（URL 同步边界）
低影响 × 低紧急  → Sprint 4（性能优化、文档）
```

---

## Sprint 1: 类型安全与测试基础设施

**时间**: Week 1-2 (2026-02-03 ~ 2026-02-14)
**目标**: 修复 P0 权限类型安全问题，建立测试基础设施

### 任务清单

| ID | 类别 | 任务 | 工作量 | 负责人 | 状态 |
|----|------|------|--------|--------|------|
| 1.1 | 稳定性 | 添加运行时验证，移除 `as unknown as` | 1.5d | - | 待开始 |
| 1.2 | 稳定性 | 集成 Membership API（Mock 先行） | 1d | - | 待开始 |
| 1.3 | 测试 | 配置 Vitest，添加首个单元测试 | 1d | - | 待开始 |
| 1.4 | 功能 | 完成 Audit/Usage 页面权限门控 | 0.5d | - | 待开始 |

### 详细说明

#### 1.1 类型安全修复

**问题**: `use-permissions.ts` 使用 `as unknown as ProjectWithMembership` 进行类型断言

**解决方案**:
1. 引入 Zod 进行运行时验证
2. 创建 `validateProjectWithMembership()` 函数
3. 在 `useHasPermission` 和 `useHasAllPermissions` 中使用

**影响文件**:
- `src/lib/hooks/use-permissions.ts`
- `src/lib/api/types/index.ts` (添加 Zod schema)

**验收标准**:
- [ ] 无 `as unknown as` 断言
- [ ] 所有 project 数据经过 `validateProjectWithMembership` 验证
- [ ] 无效数据返回 `EMPTY_PERMISSIONS` 而非崩溃

#### 1.2 Membership API 集成

**策略**: Mock First - 先定义接口契约，后端对接时无缝切换

**任务**:
1. 定义 `Membership` 类型和 `getMembership()` API
2. 在 MSW handlers 中添加 mock 实现
3. 更新 `use-permissions.ts` 从 Membership API 获取角色数据

**影响文件**:
- `src/lib/api/endpoints/members.ts` (添加 getMembership)
- `src/mocks/handlers.ts`
- `src/lib/hooks/use-permissions.ts`

**验收标准**:
- [ ] Membership API 接口已定义
- [ ] Mock 返回正确的角色权限数据
- [ ] `useHasPermission` 使用 membership.role 而非 mock 数据

#### 1.3 测试基础设施

**任务**:
1. 安装 Vitest 配置
2. 创建 `src/lib/hooks/__tests__/use-permissions.test.ts`
3. 创建 `src/lib/stores/__tests__/authStore.test.ts`

**覆盖率目标**:
- `use-permissions.ts`: >80%
- `authStore.ts`: >80%

**验收标准**:
- [ ] `npm run test:unit` 可运行
- [ ] 测试覆盖率报告生成
- [ ] CI 配置更新

#### 1.4 Audit/Usage 权限门控

**参考**: `文档/开发要求/2026-02-02-Usage-Audit-Members-Invite-实施计划-v1.md` Phase 3

**任务**:
1. Audit 页: 使用 `useHasPermission('project:audit:read')` 门控
2. Usage 页: 使用 `useHasPermission('project:usage:read')` 门控
3. 无权限时显示提示，不发起 API 请求

**影响文件**:
- `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/audit/page.tsx`
- `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/usage/page.tsx`

**验收标准**:
- [ ] user 角色不可见 Audit 页
- [ ] user 角色可见 Usage 页，end_user_id 默认锁定为自己
- [ ] owner/admin 可见 Audit 与 Usage

---

## Sprint 2: 成员管理与邀请功能

**时间**: Week 3-4 (2026-02-17 ~ 2026-02-28)
**目标**: 完成成员管理相关的 Phase 4-5 任务

### 任务清单

| ID | 类别 | 任务 | 工作量 | 负责人 | 状态 |
|----|------|------|--------|--------|------|
| 2.1 | 功能 | Member Governance 配置界面 | 1.5d | - | 待开始 |
| 2.2 | 功能 | Invite Member 功能完整流程 | 1.5d | - | 待开始 |
| 2.3 | 测试 | 为成员管理功能添加单元测试 | 1d | - | 待开始 |
| 2.4 | 稳定性 | 完善 URL-State 同步边界处理 | 0.5d | - | 待开始 |

### 详细说明

#### 2.1 Member Governance 配置

**参考**: `文档/开发要求/2026-02-02-Usage-Audit-Members-Invite-实施计划-v1.md` Phase 4

**白名单字段**:
- UserData Storage: bytes_per_end_user, objects_per_end_user
- UserData DocDB: max_collections_per_scope, max_document_bytes, query_timeout_ms, page_size_max
- UserData VectorDB: max_indexes_per_scope, top_k_max, upsert_records_max
- Endpoint: requests_per_day_per_end_user, requests_per_min_per_end_user

**任务**:
1. 定义 `MemberGovernance` 类型
2. 新增 API: GET/PATCH member governance
3. 创建 `GovernanceEditor` 组件
4. `MemberDetailDrawer` 增加 Governance Tab

**验收标准**:
- [ ] 可编辑成员 Governance 配置
- [ ] 保存前有变更预览
- [ ] 仅 `project:member:manage` 可编辑

#### 2.2 Invite Member 功能

**参考**: `文档/开发要求/2026-02-02-Usage-Audit-Members-Invite-实施计划-v1.md` Phase 5

**API 设计**:
```
POST /workspaces/{ws}/projects/{prj}/invites
Body: { email: string; role_template?: 'developer'|'user'; expires_in_hours?: number }
Response: { invite_id: string; invite_url: string; expires_at: string }
```

**任务**:
1. 定义 Invite 类型与 API
2. 创建 `InviteMemberDialog` 组件
3. Mock: POST invites, GET invite by token
4. 绑定 Invite 按钮到 MembersPage

**验收标准**:
- [ ] 点击 Invite Member 打开弹窗
- [ ] 填写 email、选择角色后提交，获得 invite_url
- [ ] 可复制链接
- [ ] 仅 owner/admin 可见 Invite 按钮

#### 2.3 成员管理单元测试

**测试范围**:
- `useMembersList` CRUD 操作
- `InviteMemberDialog` 表单验证
- `GovernanceEditor` 状态管理

**验收标准**:
- [ ] 测试覆盖率 >60% (新增代码)
- [ ] 所有 mutation 操作有测试

#### 2.4 URL-State 同步边界处理

**问题**: 深度链接、浏览器后退、无效 workspace/project ID 时可能导航黑洞

**任务**:
1. 添加边界情况处理到 `use-sync-auth-from-url.ts`
2. 测试以下场景:
   - 无效 workspace_id
   - 无效 project_id
   - 浏览器后退
   - 直接访问深度链接

**验收标准**:
- [ ] 无效 ID 重定向到有效页面
- [ ] 浏览器后退正常工作
- [ ] 无无限重定向

---

## Sprint 3: 权限系统深化与测试补充

**时间**: Week 5-6 (2026-03-03 ~ 2026-03-14)
**目标**: 完善权限验证、添加后端授权支持、补充测试覆盖

### 任务清单

| ID | 类别 | 任务 | 工作量 | 负责人 | 状态 |
|----|------|------|--------|--------|------|
| 3.1 | 稳定性 | 后端权限验证集成（API 适配器层） | 1.5d | - | 待开始 |
| 3.2 | 稳定性 | 完善 CSRF 防护机制 | 1d | - | 待开始 |
| 3.3 | 测试 | 单元测试覆盖率 >50% | 2d | - | 待开始 |
| 3.4 | 功能 | 完成 Recipe 保存到库功能 | 1d | - | 待开始 |

### 详细说明

#### 3.1 后端权限验证集成

**当前状态**: 权限检查仅前端，后端无二次验证

**解决方案**:
1. 在 API 适配器层添加权限拦截器
2. 前端权限用于 UI 隐藏，后端权限用于数据保护
3. 权限不足时返回 403，前端统一处理

**影响文件**:
- `src/lib/api/adapters/fetch-adapter.ts`
- `src/lib/api/client.ts`

**验收标准**:
- [ ] 所有 API 请求携带权限验证信息
- [ ] 403 响应统一处理，显示友好提示
- [ ] E2E 测试验证权限绕过失败

#### 3.2 CSRF 防护

**策略**: 双重 Cookie 提交

**任务**:
1. 后端设置 csrf_token Cookie
2. 前端读取并在请求头中提交
3. API 适配器自动处理

**验收标准**:
- [ ] CSRF Token 自动获取和提交
- [ ] 缺少 Token 时请求被拒绝
- [ ] 安全测试通过

#### 3.3 测试覆盖率提升

**目标**: 整体覆盖率 >50%

**优先测试文件**:
- `lib/hooks/use-sync-auth-from-url.ts`
- `lib/api/adapters/fetch-adapter.ts`
- `components/members/*`
- `components/app-shell/*`

**验收标准**:
- [ ] 覆盖率报告显示 >50%
- [ ] CI 配置覆盖率阈值检查

#### 3.4 Recipe 保存到库

**问题**: `workbench/RecipePage.tsx:162` 有 TODO 标记

**任务**:
1. 实现"保存到库"功能
2. 添加保存对话框
3. 更新 Recipe API

**验收标准**:
- [ ] 可保存 Recipe 到库
- [ ] 保存后显示成功提示
- [ ] 库中可见已保存的 Recipe

---

## Sprint 4: 性能优化与文档完善

**时间**: Week 7-8 (2026-03-17 ~ 2026-03-28)
**目标**: 优化 Bundle 大小、完善文档、准备发布

### 任务清单

| ID | 类别 | 任务 | 工作量 | 负责人 | 状态 |
|----|------|------|--------|--------|------|
| 4.1 | 性能 | Bundle 分析与 code splitting | 1.5d | - | 待开始 |
| 4.2 | 性能 | React Query 缓存策略优化 | 0.5d | - | 待开始 |
| 4.3 | 文档 | 架构决策记录（ADR）补充 | 1d | - | 待开始 |
| 4.4 | 测试 | E2E 测试补充与优化 | 1.5d | - | 待开始 |

### 详细说明

#### 4.1 Bundle 优化

**任务**:
1. 使用 `@next/bundle-analyzer` 分析
2. 对重型组件动态导入:
   - Monaco Editor (如有)
   - 图表组件
3. 路由级 code splitting

**目标**:
- Bundle 体积减少 >30%
- FCP <1.5s

**验收标准**:
- [ ] Bundle 分析报告生成
- [ ] 动态导入配置完成
- [ ] Lighthouse 性能分数 >90

#### 4.2 React Query 优化

**任务**:
1. 调整 staleTime 策略
2. 添加 cacheTime 配置
3. 优化 refetchOnWindowFocus

**验收标准**:
- [ ] 不必要的重新请求减少
- [ ] 数据新鲜度保持

#### 4.3 ADR 文档

**记录关键决策**:
1. 权限系统设计（为什么选择这种模式）
2. 状态管理策略（Zustand + React Query）
3. URL-State 同步架构
4. API 适配器模式
5. Mock First 策略

**存放位置**: `docs/adr/`

**验收标准**:
- [ ] 至少 5 个 ADR 文档
- [ ] 每个包含: 决策、背景、选项、结果

#### 4.4 E2E 测试补充

**补充场景**:
1. 深度链接导航
2. 权限边界情况
3. 成员邀请流程
4. Governance 配置流程

**验收标准**:
- [ ] E2E 测试覆盖关键用户旅程
- [ ] CI 中稳定运行（无 flaky）

---

## 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 后端 API 延迟 | Mock 与真实 API 契约不一致 | 中 | 严格按文档定义接口，后端开发时同步更新 |
| 测试覆盖率目标未达成 | 重构风险 | 低 | 优先覆盖核心路径，接受非关键代码覆盖率较低 |
| Git Worktree 管理复杂 | 开发体验 | 低 | 提供清晰的工作树创建/删除脚本 |
| Sprint 时间估算不准 | 进度延误 | 中 | 每个 Sprint 结束时回顾调整 |

---

## 工作流程

### Git Worktree 策略

每个 Sprint 使用独立的 worktree：

```bash
# 创建 Sprint 1 worktree
git worktree add ../mbos-frontend-v1-sprint1 -b sprint/1-type-safety

# 在 worktree 中工作
cd ../mbos-frontend-v1-sprint1
npm install
npm run dev

# 完成后合并到主分支
git checkout main
git merge --squash sprint/1-type-safety

# 清理 worktree
git worktree remove ../mbos-frontend-v1-sprint1
git branch -D sprint/1-type-safety
```

### 提交规范

```
<type>(<scope>): <subject>

type: feat|fix|refactor|test|docs|chore
scope: sprint1|sprint2|sprint3|sprint4
subject: 简短描述

示例:
feat(sprint1): 添加运行时验证修复权限类型安全
test(sprint1): 为 use-permissions 添加单元测试
refactor(sprint1): 移除 as unknown as 类型断言
```

### 验收检查清单

每个 Sprint 完成时检查：

- [ ] 所有任务已完成
- [ ] 单元测试通过
- [ ] E2E 测试通过
- [ ] 代码审查通过
- [ ] 文档已更新
- [ ] CHANGELOG.md 已更新

---

## 后续计划

完成 4 个 Sprint 后：

1. **回顾与调整**: 评估效果，调整后续策略
2. **长期改进**: 考虑微前端架构、依赖注入等
3. **监控建立**: 集成前端监控（Sentry/LogRocket）
4. **持续优化**: 建立 Bundle 大小监控、性能预算

---

## 参考文档

- `ARCHITECTURE_REVIEW_2026-02-03.md` - 架构评审报告
- `文档/开发要求/2026-02-02-Usage-Audit-Members-Invite-实施计划-v1.md` - Phase 4-5 详细设计
- `文档/权威设计/01-认证授权/权限点标准规范-v1.md` - 权限系统规范
- `文档/UXUI/2026-02-02-Project-Settings-Runtime-Preferences-Governance-Member-配置界面设计-v1.md` - Governance 设计

---

**文档状态**: 待评审与执行

**下一步**: 开始 Sprint 1 实现
