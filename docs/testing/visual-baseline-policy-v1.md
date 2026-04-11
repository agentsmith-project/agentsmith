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

## 2. Evidence types

1. `整页视觉基线`
2. `局部视觉基线`
3. 不再默认用整页 visual 证明局部交互改动

## 3. Default engineering gate vs visual verification

默认工程门禁使用：
```bash
npm run gate:default
```

full visual 验证使用：
```bash
npm run lane:visual
```

结论：
- targeted visual 可以属于默认业务链或治理链 gate
- full visual 只属于 `lane:visual`
- 发布验收使用 `lane:visual`，而不是让 `gate:default` 代替它
