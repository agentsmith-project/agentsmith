# Visual Baseline Policy v1

Last updated: 2026-04-11  
Owner: Frontend

## 1. Positioning

1. `视觉验证` 是正式证据通道，不是临时截图工具。
2. `默认工程门禁` 聚焦功能正确性，不因为 full visual 缺失自动阻断。
3. `视觉验证通道` 失败时，应阻断视觉证据验收。
4. 发布是否要求视觉审查，必须由 release 规则显式决定。
5. Visual baseline 文件位于 `e2e/__screenshots__/`，属于受版本管理的正式证据。
6. 当前 desktop visual baseline 视口固定为 `1920x1080`。
7. committed baseline 不是 release authority artifact；它只是 comparison input。
8. 当前 release authority artifact 是 producer-owned `artifacts/visual-baseline-reviews/<run-id>/run-manifest.json` 与同 run 下的 actual captures。

## 2. Evidence types

1. `整页视觉基线`
2. `局部视觉基线`
3. 不再默认用整页 visual 证明局部交互改动

## 3. Default engineering gate vs visual verification

常规验证入口按目标选择；需要 full visual 结论时使用：
```bash
npm run verify -- --goal=visual --run
```

发布收口使用 `npm run release:ready` / `npm run release:status`。

结论：
- targeted visual 可以属于对应业务链或治理链证据
- full visual 的内部 evidence owner 是 `lane:visual`，但日常不要直接把它当成 copyable workflow
- 发布验收使用 `npm run release:ready`，不能用默认检查或 visual owner 命令替代

## 4. Producer-owned evidence contract

1. `run-manifest.json`
- 当前 schema 为 `visual_baseline_run_manifest/v2`
- 它必须由 visual producer 写出，wrapper 只能复制，aggregate 只能验证

2. `actual capture`
- 每个截图条目必须通过 `actual_relpath` 指向 run-scoped actual capture 文件
- `actual_sha256` 必须从该 actual capture 文件计算

3. `actual_url`
- 必须保留完整 route canonical form，也就是 `pathname + search`
- 不能把 query-bearing visual scene 收缩成纯 pathname
