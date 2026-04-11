# Current Baseline (Whitelist)

更新时间：2026-04-11  
状态：`authoritative`

本文件只负责两件事：
1. 定义当前真相源与阅读顺序
2. 明确 current 文档与历史材料的边界

## 1. 当前真相源

如果你需要判断“现在应该以什么为准”，按下面顺序读：

1. [项目宪法](./项目宪法.md)
   - 产品定位、范围边界、禁止漂移项
2. [DESIGN.md](../DESIGN.md)
   - 当前唯一 UI 宪法与设计语言真相
3. [Product Terminology Contract](./contracts/product-terminology.md)
   - 当前正式产品对象名、页面名、IA 边界、用户可见命名
4. [Current Engineering Governance Model](./current-engineering-governance-model.md)
   - 当前命令模型、测试/门禁/验证通道/发布语义
5. [Contracts Index](./contracts/README.md)
   - 当前合同分类与实施依据
6. [User Guides Index](./user-guides/README.md)
   - 当前运行、发布、排障与证据入口
7. [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)
   - Notebook / terminal runner 的当前操作与约定

## 2. current 文档怎么判断

默认把下面几类文档视为背景、阶段性或历史材料，不能直接覆盖 current 真相：

- 标题包含 `handoff`
- 标题包含 `refactor`
- 标题包含 `migration`
- 标题包含 `retro`
- 标题包含 `todo`
- 明显的 task / phase / one-off checklist 文档

这些文档可以保留背景、迁移前后对照和一次性调查结果，但不直接改写当前产品边界、UI 真相或工程命令模型。

## 3. 当前文档怎么用

### 如果你要理解当前产品是什么

按顺序读：
1. [项目宪法](./项目宪法.md)
2. [DESIGN.md](../DESIGN.md)
3. [Product Terminology Contract](./contracts/product-terminology.md)

### 如果你要实现或评审功能

按顺序读：
1. [Contracts Index](./contracts/README.md)
2. [Product Terminology Contract](./contracts/product-terminology.md)
3. [DESIGN.md](../DESIGN.md)
4. [Current Engineering Governance Model](./current-engineering-governance-model.md)

### 如果你要运行、排障、发布或做排演

按顺序读：
1. [User Guides Index](./user-guides/README.md)
2. [Current Engineering Governance Model](./current-engineering-governance-model.md)
3. [Troubleshooting Guide](./troubleshooting-guide-v1.md)
4. [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)

## 4. 当前必须保留的入口

以下入口必须保持 current、可导航、可维护：

1. [Documentation Index](./README.md)
2. [Contracts Index](./contracts/README.md)
3. [User Guides Index](./user-guides/README.md)
4. [DESIGN.md](../DESIGN.md)

要求：
1. `docs/README.md` 只负责目录索引，不再承担 current truth router 职责
2. `DESIGN.md` 是唯一 UI 宪法；`docs/UXUI/` 只保留依赖它的 interaction/spec library
3. current 文档与历史材料必须分区明确

## 5. 文档冲突时按谁为准

当前优先级固定为：
1. 宪法
2. 当前合同与产品对象边界
3. `DESIGN.md`
4. 当前工程治理模型
5. 用户指南 / runbook
6. 历史材料 / 设计稿 / retro / handoff

补充说明：
1. 产品对象名、页面 IA、用户可见命名冲突时，以 [Product Terminology Contract](./contracts/product-terminology.md) 为准。
2. 全局 UI 语言、视觉边界与设计原则冲突时，以 [DESIGN.md](../DESIGN.md) 为准。
3. 工程命令、Gate、验证通道、发布流程冲突时，以 [Current Engineering Governance Model](./current-engineering-governance-model.md) 和 machine-readable manifests 为准。

## 6. 执行规则

1. 白名单之外文档不作为 current 需求与评审依据。
2. 若需新增治理维度、页面对象或工程入口，先改 current 真相源，再做代码。
3. 若发现某份 `authoritative` 文档与 terminology contract、宪法、`DESIGN.md` 或治理模型冲突，应优先修正文档真相，而不是继续叠加说明。
