# Project Maturity & Productization Review v1

更新时间：2026-03-01  
状态：`current-baseline`

前置参考：

1. `README.md`
2. `docs/项目宪法.md`
3. `docs/release/internal-release-capability-matrix.md`
4. `docs/release/internal-release-note-2026-02-28-closure.md`
5. `docs/design/agentsmith-product-engineering-governance-methodology-v1.md`
6. `docs/design/ai-ops-home-ux-closure-review-v1.md`

---

## 1. 这份评估回答什么

当前要回答的不是“代码写了多少”，而是：

1. AgentSmith 现在离企业级内部产品还有多远
2. 哪些能力已经具备平台级成熟度
3. 哪些能力仍然停留在“后端有能力、产品层解释不足”
4. 下一条主线最应该投入在哪里

---

## 2. 当前总体判断

### 2.1 产品初衷没有漂移

当前项目仍然稳定围绕三个核心：

1. 企业级 AI 智能体使用与管理
2. AI 资源治理
3. 运行与发布治理

它没有偏成：

1. 纯聊天工具
2. 纯工程发布系统
3. 纯 BI/报表后台

方向是稳定的。

### 2.2 当前成熟度结论

如果按内部企业产品标准评估，当前状态可定义为：

`中后期内部产品化阶段`

更具体地说：

1. 核心运行与治理能力已经成体系
2. 发布与证据链已经达到较高成熟度
3. UX 主框架已经完成第一轮产品化
4. 主要短板已经从“有没有能力”转成“能否被运营人员直接理解和验证”

---

## 3. 分维度成熟度评估

### 3.1 产品定位与边界：高

当前优点：

1. 顶层定位已经与代码现实对齐
2. 项目宪章、README、release baseline 一致
3. 产品边界清楚，知道什么是主线、什么不是

当前风险：

1. 个别历史计划文档仍然较多，但已不再作为活动入口

判断：

`高成熟`

### 3.2 运行控制与资源治理：高

当前优点：

1. runtime routing / pricing / cost / attempts / fallback 已闭环
2. usage / cost / export / scheduled report / webhook delivery 已闭环
3. governance execution 已进入真实 backend effect
4. release gate 已纳入 runtime / usage / governance evidence

当前风险：

1. 治理解释层还没有完全产品化

判断：

`高成熟`

### 3.3 发布治理与可运营性：高

当前优点：

1. policy engine
2. override / approval
3. run history
4. escalation / SLA / incident trace
5. release ops artifact browser
6. release report 真正带 evidence 和 gate result

当前风险：

1. 已经不缺“看板”，更缺“业务治理可解释性”

判断：

`高成熟`

### 3.4 UX / 信息架构：中高

当前优点：

1. `AI Ops Home` 已形成统一任务入口
2. `Home / Build / Govern / Operate` 信息架构已成型
3. `Build / Govern / Operate` 页头动作已统一
4. 共享状态语言和共享过滤上下文已落地

当前风险：

1. `Govern` 面的深层解释能力仍弱于 `Operate`
2. 少量页面仍有低优先级视觉 polish 空间

判断：

`中高成熟`

### 3.5 治理解释性与有效权限/配额可见性：中

当前优点：

1. backend 已有 explain primitives：
   - `/authorize`
   - `matched_policy`
   - `missing_permissions`
   - `membership_status`
   - per-permission `decisions`
2. backend 已有真实 enforcement 和 evidence

当前短板：

1. 前端没有正式的 effective access / effective quota / deny reason console
2. `Members / Resource Policy` 更像配置面，而不是解释面
3. 运营人员很难直接回答：
   - 这个人为什么被拒绝
   - 当前有效权限从哪里来
   - 当前有效配额由哪条规则决定
   - 这次 deny 到底是 membership、permission 还是 resource policy

判断：

`中等成熟`

### 3.6 对外商业化/外部客户准备度：低到中

当前事实：

1. 当前产品明显优先服务内部用户
2. 治理、运行、发布控制已经强于商业计费、客户隔离、外部运维支持
3. 这不是缺陷，而是阶段选择

判断：

`当前不是优先目标`

---

## 4. 产品化进度判断

### 4.1 已完成的产品化阶段

以下阶段基本已经完成：

1. 从“功能堆叠”到“产品对象模型”
2. 从“前端页面存在”到“后端真实 effect”
3. 从“零散发布检查”到“release governance control plane”
4. 从“模块导航”到“任务化信息架构”

### 4.2 当前所处阶段

当前项目正处在：

`从治理执行成熟，迈向治理解释成熟`

也就是说，系统现在主要缺的不是：

1. 更多配置页
2. 更多 dashboard 卡片
3. 更多流程按钮

而是：

1. 把已经正确的治理执行结果解释给用户
2. 把 effective state 做成一等产品能力
3. 让排障和验证不需要依赖读源码或读 smoke 脚本

---

## 5. 当前主要短板

### 5.1 Explainability 不足

这是当前最明显的产品化缺口。

backend 已经知道：

1. 权限为什么 grant/deny
2. membership 当前状态是什么
3. resource policy 命中了哪条规则
4. 配额检查为什么超限

但前端还没有把这些事实做成统一、稳定、可操作的产品界面。

### 5.2 Govern 面仍偏配置，不够偏“有效态”

当前 `Govern` 页更容易回答：

1. 你配置了什么

但不够容易回答：

1. 现在实际生效的是什么
2. 为什么是这样
3. 如果访问失败，应该先查哪一层

### 5.3 有效访问排障仍不够低成本

当前要排一条访问拒绝，仍可能需要在这些地方来回跳：

1. members
2. resource policy
3. audit
4. release / governance evidence
5. backend explain payload

这说明 explainability 还没真正产品化。

---

## 6. 下一主线建议

建议下一主线正式定义为：

`Governance Explainability & Effective Access Console`

中文建议表述为：

`治理解释性与有效访问控制台`

这条主线的目标不是再做一套治理后台，而是把现有治理执行结果转成：

1. 可解释
2. 可验证
3. 可排障
4. 可运营

---

## 7. 为什么它应该是下一优先级

### 7.1 它直接补当前最真实的产品空白

现在的短板不是执行链不对，而是：

1. 执行链已经对了
2. 但产品层没有把“为什么这样”解释清楚

### 7.2 它比继续做 UX polish 更有价值

当前 UX 主框架已经成型。  
继续 polish 只有局部收益，而 explainability 能显著降低治理操作和排障成本。

### 7.3 它比继续扩 Release Ops 更有价值

Release Ops 已经够强。  
继续扩页面不会弥补 `Govern` 面 explainability 的真实空白。

---

## 8. 下一主线的目标结果

下一主线完成后，系统应当能直接回答：

1. 某个用户当前在某项目的有效权限是什么
2. 这些权限来自：
   - project default
   - group template
   - member template
   - member custom
3. 当前 membership 状态是否影响访问
4. 某个 endpoint / source library / agent 的访问是被哪条 policy allow/deny
5. 某次 quota 超限命中了哪条有效 quota
6. 运营人员如何从一个 deny 结果直接 drill down 到对应的成员、策略和证据

---

## 9. 结论

当前项目的成熟度结论是：

1. 产品方向稳定
2. 运行控制、资源治理、发布治理已经进入高成熟阶段
3. UX 主框架已完成第一轮产品化
4. 当前最大的产品化缺口已经转向：
   - `治理解释性`
   - `有效权限/配额/策略可见性`

所以，下一主线不应再是：

1. 零散 UX polish
2. 继续扩 `Release Ops`
3. 新一轮大规模 runtime 页面增强

而应当是：

`治理解释性与有效访问控制台`
