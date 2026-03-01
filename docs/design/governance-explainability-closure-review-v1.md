# Governance Explainability Closure Review v1

更新时间：2026-03-01  
状态：`baseline-complete`

前置文档：

1. `docs/design/project-maturity-productization-review-v1.md`
2. `docs/plans/governance-explainability-effective-access-console-plan-v1.md`
3. `docs/项目宪法.md`

---

## 1. 结论

`Governance Explainability & Effective Access Console` 第一阶段已经完成，可以正式收口为当前基线。

这条主线完成的不是“多几个治理页面”，而是把已经存在的后端治理执行结果，转成了正式的产品解释能力。

当前判断：

1. explainability 第一阶段目标已达成
2. 主要结构缺口已经补齐
3. 后续若继续投入，应进入第二阶段深化，而不是继续把当前计划当作活动主线

---

## 2. 本轮原始目标

本轮要解决的核心问题是：

1. `Members` 只能看配置，不能看 effective access
2. `Resource Policy` 能配置规则，但不能解释规则命中
3. quota / deny / forbidden 事件只能看 raw metadata，不能低成本解释
4. `Govern / Audit / Usage` 之间缺少带上下文的 explain drill-down

---

## 3. 已完成内容

### 3.1 Effective Access Contract 已冻结

已完成：

1. explainability typed API contract
2. explainability hooks
3. raw backend error payload 保留到 `APIError.details`
4. frontend 不再需要在多个页面散落地解析 explain raw payload

结果：

1. explainability 已经进入正式 API 层
2. 后续 UI 可以在统一 contract 上继续扩展

### 3.2 `Members` 已具备 effective access console

已完成：

1. `Effective Access` tab
2. membership status 展示
3. effective permissions 展示
4. quota overrides 展示
5. member-scoped authorization check

结果：

1. 管理员可以直接看到某成员当前“实际生效的访问状态”
2. grant / deny 不再只能靠读配置表理解

### 3.3 `Resource Policy` 已具备 explain console

已完成：

1. 基于当前选中资源的 explain panel
2. subject access check
3. matched policy / matched subject / source / reason 展示

结果：

1. endpoint / source library / agent 等治理对象已有统一 explain 入口
2. “为什么 allow/deny”已经能在页面里直接回答

### 3.4 quota / deny / forbidden 已进入结构化 evidence 视图

已完成：

1. `Usage` 请求详情中的治理证据区块
2. `Audit` 事件详情中的治理证据区块
3. 统一展示：
   - governance kind
   - enforcement kind
   - quota key
   - effective limit
   - current usage
   - scope
   - membership status
   - missing permissions

结果：

1. quota exceeded、resource policy denied、route forbidden 都不再只是错误码或 JSON
2. 运营人员可以直接解释治理结果

### 3.5 Cross-Surface Explain Workflow 已打通

已完成：

1. `Usage / Audit -> Members` 深链
2. `Usage / Audit -> Resource Policy` 深链
3. query 上下文会自动恢复：
   - 目标成员
   - authorization check 输入
   - 目标资源
   - explain subject/action

结果：

1. 从一条 deny / quota 事件到定位 effective access 或 matched policy，已不需要人工拼链路
2. explain workflow 已形成正式产品路径

---

## 4. 验收结论

本轮计划中的五个工作包已经全部完成：

1. `WP-01 Effective Access Contract`
2. `WP-02 Members Effective Access Console`
3. `WP-03 Resource Policy Explain Console`
4. `WP-04 Quota Explain & Evidence Drill-down`
5. `WP-05 Cross-Surface Explain Workflow`

验收判断：

1. effective access 已经成为正式产品能力
2. matched policy explain 已经成为正式产品能力
3. quota / deny / forbidden 的解释能力已经进入日常运营界面
4. explain drill-down 已具备跨页面连续性

---

## 5. 当前残余问题

### 5.1 非阻塞深化项

可以继续做，但不应阻塞当前主线收口：

1. permission simulation
2. subject precedence 可视化
3. policy impact preview
4. 更多 governance event 类型的 explain enrichment

### 5.2 不属于本主线的问题

1. 更深的审批/发布治理增强
2. 新一轮 runtime UI 增强
3. 商业计费/对外账单

这些都不该再混入 explainability 主线。

---

## 6. 为什么现在应该收口

当前 explainability 第一阶段的核心结构债已经解决。

继续在这条线上投入，如果没有新的明确目标，很容易退化成：

1. 零散字段补充
2. 局部 explain 文案微调
3. 没有明确边界的治理页面扩张

更合理的策略是：

1. 冻结当前 explainability 基线
2. 把剩余项视为第二阶段候选
3. 只有在新的目标明确时，再启动 explainability 第二阶段

---

## 7. 当前基线定义

从现在开始，以下内容视为正式 explainability 基线：

1. `Members` 的 effective access 视图
2. `Resource Policy` 的 matched policy explain
3. `Usage / Audit` 的治理证据结构化展示
4. `Usage / Audit -> Members / Resource Policy` 的上下文 explain drill-down
5. typed explainability contract + hooks + 测试 + targeted e2e / visual 验证

---

## 8. 对后续主线的约束

后续若继续做治理相关能力，应遵守：

1. 优先复用当前 explainability contract，不再散落解析 raw governance payload
2. 新增 deny / quota / effective-state 事件，优先接到现有 evidence UI
3. 新增治理页面或详情，不重新发明 explain drill-down 入口
4. 若要继续扩 explainability，必须以“第二阶段”明确立项

---

## 9. 最终建议

建议正式结束本轮 `Governance Explainability & Effective Access Console` 第一阶段。

下一步应切回新的产品/工程主线，或在明确目标后再启动 explainability 第二阶段。
