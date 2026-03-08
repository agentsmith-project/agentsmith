# Release Governance Control Plane (Archived)

更新时间：2026-03-07  
状态：`archived`

该文档描述的 `Release Ops` 模块已下线，不再作为当前产品主线。

## Migration

旧入口：

```text
/[locale]/workspaces/[workspace]/projects/[project]/release-ops
```

当前入口：

```text
/[locale]/workspaces/[workspace]/projects/[project]/runtime-console?tab=control
```

治理与排障请使用以下页面组合：

1. Runtime Console（控制与运行视角）
2. Usage（用量、成本、限流/限额效果）
3. Audit（策略命中、拒绝、审计证据）
4. Resource Policy（项目级策略配置）

## Notes

1. 旧的 release run / escalation / override 专属操作说明已归档，不作为当前 MVP 交付要求。
2. 当前 MVP 治理范围为项目级、LLM endpoint 统一约束链路（Chat/Notebook/API 同一套约束）。
3. 若历史脚本仍提及 release 术语，请以 Runtime Console + Usage/Audit 的证据链替代。
