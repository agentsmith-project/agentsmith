# Visual Baseline Policy v1

Last updated: 2026-03-08  
Owner: Frontend

## 1. Positioning

1. `视觉验证` 是正式证据通道，不是临时截图工具。
2. `默认工程门禁` 默认聚焦功能正确性，不因为 visual 缺失自动阻断。
3. `视觉验证通道` 失败时，应阻断视觉证据验收。
4. `发布` 是否要求视觉审查，必须由发布规则显式决定。
5. Visual baseline 文件位于 `e2e/__screenshots__/`，属于仓库内受版本管理的正式证据。
6. 当前 desktop visual baseline 视口固定为 `1920x1080`。
7. Playwright visual runs 必须显式使用 `--window-size=1920,1080` 且页面 viewport 为 `1920x1080`。

## 2. Evidence Types

1. `整页视觉基线`
   - 用于页面级布局、整体结构、导航框架变化。
2. `局部视觉基线`
   - 用于对话框、侧栏、通知下拉、CTA 区、关键小组件。
3. 不再默认用整页 visual 证明局部交互改动。

## 3. Default Engineering Gate vs Visual Verification

默认工程门禁使用：

```bash
npm run test:e2e
```

等价于：

```bash
playwright test --project=smoke --project=chromium
```

这表示：
- 默认工程门禁聚焦 `轻量验证 + 默认 e2e`
- `视觉验证` 通过单独通道执行：

```bash
npm run lane:visual
```

## 4. Baseline Update Workflow

当 UI 改动需要视觉审查时：

1. 只更新本次改动相关的 visual 场景：
   ```bash
   npm run test:e2e:lane:mock:visual:update
   ```
2. 确认截图使用 `1920x1080`。
3. 审阅生成的基线差异。
4. 再跑一次非 update 的 visual 检查：
   ```bash
   npm run lane:visual
   ```
5. 将基线更新与功能改动一起作为正式代码变更提交。

## 5. Scope Control

1. 不将 visual baseline churn 与无关功能/重构混在同一提交中。
2. Usage/Audit UX 改动优先保证角色边界清晰和低认知负担，再考虑像素级稳定。
3. 不允许使用临时 viewport 更新 baseline；除非本 policy 被显式修订，否则 `1920x1080` 是当前唯一接受的 desktop baseline。
4. 局部交互改动应优先补局部视觉基线，而不是反复依赖整页截图。
