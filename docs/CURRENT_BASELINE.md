# Current Baseline (Whitelist)

更新时间：2026-04-11  
状态：`authoritative`

本文件的职责只有两件事：

1. 定义当前文档白名单与阅读顺序
2. 明确“当前真相”和“历史/背景材料”的边界

它不再重复定义完整产品面、页面 IA、命令矩阵或部署细节。  
这些真相已经分别收口到更合适的 current 文档中。

## 1. 当前真相源

如果你需要判断“现在应该以什么为准”，按下面顺序读：

1. [项目宪法](./项目宪法.md)
   - 产品定位、范围边界、治理主线、禁止漂移项
2. [Product Terminology Contract](./contracts/product-terminology.md)
   - 当前正式产品对象名、页面名、IA 边界、用户可见命名
3. [Current Engineering Governance Model](./current-engineering-governance-model.md)
   - 当前工程命令模型、测试/门禁/验证通道/发布语义
4. [Contracts Index](./contracts/README.md)
   - 当前合同分类与实施依据
5. [User Guides Index](./user-guides/README.md)
   - 当前运行、发布、排障、证据与操作说明入口
6. [Troubleshooting Guide](./troubleshooting-guide-v1.md)
   - 当前有效排障入口

## 2. 如何判断一份文档是不是 current

默认把下面几类文档视为“背景、阶段性或历史材料”，不能直接覆盖 current 真相：

- 标题包含 `handoff`
- 标题包含 `refactor`
- 标题包含 `migration`
- 标题包含 `retro`
- 标题包含 `todo`
- 明显的 task / phase / one-off checklist 文档

这些文档可以保留：

- 旧术语
- 迁移前后对照
- 阶段性决策背景
- 一次性排查记录

但它们不直接改写当前产品边界、当前命令模型或当前页面/对象真相。

## 3. 当前文档怎么用

### 如果你要理解当前产品是什么

先读：

1. [项目宪法](./项目宪法.md)
2. [Product Terminology Contract](./contracts/product-terminology.md)
3. [Documentation Index](./README.md)

重点：

- 产品范围和禁止扩张项看宪法
- 当前产品面、治理对象、页面命名、IA 边界看 terminology contract
- 文档入口和分类看 docs index

### 如果你要实现或评审功能

先读：

1. [Contracts Index](./contracts/README.md)
2. [Product Terminology Contract](./contracts/product-terminology.md)
3. [Current Engineering Governance Model](./current-engineering-governance-model.md)

重点：

- 实施依据和合同分层看 contracts index
- 用户可见命名与 IA 约束看 terminology contract
- 命令/Gate/验证通道真相看 governance model

### 如果你要运行、排障、发布或做排演

先读：

1. [User Guides Index](./user-guides/README.md)
2. [Troubleshooting Guide](./troubleshooting-guide-v1.md)
3. [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)

重点：

- local runtime / deploy / rehearsal 入口看 user guides
- 定位问题先看 troubleshooting
- Notebook runner / task workspace / terminal 主链看 notebook runbook

## 4. 当前必须保留的索引入口

以下索引必须保持 current、可导航、可维护：

1. [Documentation Index](./README.md)
2. [Contracts Index](./contracts/README.md)
3. [User Guides Index](./user-guides/README.md)

要求：

1. index 文档只负责路由与分类，不再承担重复定义产品真相
2. current 文档与历史材料必须分区明确
3. runtime / deploy / rehearsal 的入口必须能从 index 直达

## 5. 必读文档（当前最小集合）

1. [项目宪法](./项目宪法.md)
2. [Product Terminology Contract](./contracts/product-terminology.md)
3. [Current Engineering Governance Model](./current-engineering-governance-model.md)
4. [Contracts Index](./contracts/README.md)
5. [User Guides Index](./user-guides/README.md)
6. [Troubleshooting Guide](./troubleshooting-guide-v1.md)

## 6. 文档冲突时按谁为准

当前优先级固定为：

1. 宪法
2. 当前合同
3. 当前工程治理模型
4. 用户指南 / runbook
5. 设计稿 / 过程文档 / retro / handoff

补充说明：

1. 产品对象名、页面 IA、用户可见命名冲突时，以 [Product Terminology Contract](./contracts/product-terminology.md) 为准。
2. 工程命令、Gate、验证通道、发布流程冲突时，以 [Current Engineering Governance Model](./current-engineering-governance-model.md) 和 machine-readable manifests 为准。
3. 历史/背景材料只用于理解上下文，不直接作为需求与评审依据。

## 7. 执行规则

1. 白名单之外文档不作为 current 需求与评审依据。
2. 若需新增治理维度、页面对象或工程入口，先改 current 真相源，再做代码。
3. 若发现某份 `authoritative` 文档与 terminology contract、宪法或治理模型冲突，应优先修正文档真相，而不是继续叠加说明。
