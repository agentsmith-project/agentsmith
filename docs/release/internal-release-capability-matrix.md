# Internal Release Capability Matrix

更新时间：2026-03-01  
状态：`current-baseline`

这份矩阵只描述当前内部 release 基线下**真实后端已验证的能力范围**。  
它不再用“页面是否部分可见”来表达成熟度，而是用“哪些执行效果已被真实验证”来表达。

## 1. 主线能力（real backend）

以下链路已作为当前内部 release 基线的一部分：

1. Files / source libraries 核心流程
2. Notebook tasks / messages / traces / artifacts
3. External agent runtime（Codex runner）
4. Notebook attached inputs / inputrefs
5. Runtime / Usage / Release governance control plane

## 2. 治理能力（real backend）

### 2.1 Audit / Usage

已验证：

1. persisted audit events
2. persisted usage facts
3. usage KPI / facts / export
4. governance / runtime / release evidence linkage

### 2.2 Members

已验证：

1. join request create / approve / reject
2. group CRUD + template apply
3. permission template / quota template CRUD
4. member permission overrides
5. member quota overrides
6. membership `suspend / restore / revoke`
7. revoke downstream cleanup
   - group membership
   - member permission state
   - member quota overrides
8. suspend / restore downstream effect correctness

### 2.3 Resource Policy

已验证：

1. `endpoint`
   - allow-all / allow-list
   - user / group subject matching
   - `requests_per_minute`
   - `daily_token_limit`
   - `requests_per_day`
2. `agent`
   - allow-list access
   - `requests_per_minute`
3. Files 模块采用成员隔离默认库模式，不纳入统一 resource policy 治理范围

### 2.4 Backend Authorization

已验证：

1. shared backend authz engine
2. explainable `/authorize` decision
3. project read surfaces aligned to backend decision semantics
4. membership status / missing permissions / per-permission decisions returned in authz explain path

## 3. 安全链路

已验证：

1. `/api/v1/sse-ticket` issues opaque short-lived ticket
2. non-SSE routes reject `?ticket=...`
3. legacy JWT query fallback is disabled
4. governance release smoke contains dedicated SSE hardening check

## 4. 发布治理

已验证：

1. release report
2. release runs
3. release escalations
4. release policy / override / approval
5. governance release evidence
6. runtime release evidence
7. usage report evidence
8. workspace governance release evidence
9. organization governance release evidence
10. incident linkage and ownership / SLA

## 5. 当前边界

这份矩阵仍然保留“支持边界”概念，但不再使用旧的 `partial backend` 说法。

当前边界是：

1. 只声明已被真实 smoke / integration / release gate 验证过的治理效果
2. 不声明“所有 resource policy 字段都已有统一执行器”
3. 不声明“所有前端配置项都对所有资源类型完全对称生效”

换句话说：

1. 当前基线已经是**真实执行闭环**
2. 但治理执行仍按**已验证范围**对外说明，而不是无限泛化

## 6. 使用方式

1. 判断某条能力是否可以作为内部 release 基线承诺
2. 判断 smoke / gate 是否应把某类失败当成结构性故障
3. 更新 release closure note 时作为能力边界来源

## 7. 相关文档

1. [internal-release-note-2026-02-28-closure.md](./internal-release-note-2026-02-28-closure.md)
2. [release-verification.md](../user-guides/release-verification.md)
3. [release-governance-control-plane.md](../user-guides/release-governance-control-plane.md)
4. [项目宪法.md](../项目宪法.md)
