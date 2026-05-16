# 发布前检查清单

这份清单用于当前版本的最终发布验收。

术语边界：
- 这里的 `release` 仅表示工程验收与上线准备流程。
- 不代表 AgentSmith 提供对外 DevOps 发布管理能力。

## 通过标准

只有下面 4 类检查都通过，当前版本才可视为 `ready for release`：
1. 合约与类型检查通过。
2. 默认业务链与治理门禁通过。
3. release-grade backend-real 验证通过。
4. full visual、machine-readable story evidence 与 unified deploy 证据通过。

补充判定规则：
1. 当前面向人的 automated release-grade 执行入口统一是 `npm run release:ready`。
2. `npm run release:status` 是只读入口，只读取 latest summary / status，不重新聚合 evidence；默认人类输出是短摘要，机器可读完整投影用 `--json`。
3. 默认 release campaign 使用 `local-kind` 和 focused product-flow producers 证明统一部署；`existing-cluster` 是需要目标集群时显式执行的 operator smoke。
4. 机器可读报告语境：`gate:default` does not run the full visual lane，也不能代替 release-grade backend-real 或最终 release verdict。
5. 对 evidence-owning gates 和 lanes，`command passed` 与 machine-readable evidence completeness 同级；缺少 required review artifacts、`visual_scene_catalog` 或 `ux_trace_bundle`，都不能算通过。
6. 维护者排障语境：`gate:release:full` is aggregate-only terminal verdict verification；它只验证已有 campaign evidence，不执行 suite，也不是普通人工入口。
7. `release:ready` / `release:status` 不清理或改写原始日志；NO_COLOR、Postgres already exists、containerd deprecation 这类常见 setup warning 只有在 summary/evidence 明确列为 blocker 时才影响主结论。

## 环境前提

发布级验证前，先确认：
1. Keycloak 集成依赖可用。
2. 真实 backend-real 所需的 endpoint / API key 已配置。
3. 本机没有残留的多余 `next dev` 进程与 scenario。

## 自动化与手工边界

1. 本文里的自动化 release-grade campaign，指当前 machine-readable gates、lanes 与 release-grade backend-real 证据链。
2. `gate:*`、`lane:*`、`backend-real:*`、`release:campaign:*` 都是 internal adapter / evidence producer surface，保留给 CI、`npm run release:ready` 和 owner runbook，不作为普通发布人员的 copyable command 目录。
3. `make manual-feishu-*` 属于 release operator 手工联调步骤，不属于 automated gate identity，也不会改变 canonical gate-result schema。
4. 如果当前 release scope 需要 Feishu 联调，手工步骤仍然可能影响最终放行判断；但它们必须与 automated verdict 分层记录，不能伪装成“某个 gate 已经覆盖”。

## 验证顺序

### 1. Clean Human Entrypoints

日常 release-grade 自动化入口只跑：

```bash
npm run release:ready
npm run release:status
```

维护者排障语境：`npm run release:ready` 先运行 `npm run test:release:precheck` 作为非 verdict guard。precheck 失败时会停止并输出 NOT STARTED，表示未进入 campaign、没有 release verdict。precheck 通过后才委托 internal adapter family 编排 required steps，并在 campaign context 内调用 terminal aggregate verdict。结束时优先看短摘要里的 `Evidence` / `Terminal result` / `Summary` 路径；上方原始日志仍保留用于排障。

### 2. 维护者排障 / Owner Producer Diagnostics

下面命令只在 failure summary、owner runbook 或 manifest 明确指向部署 evidence owner 时用于定位；它们不是默认 automated release 执行路径，不能替代 `npm run release:ready`：

```bash
npx tsx scripts/unified-deploy/substrate-lifecycle.ts reset
npm run test:unified-deploy:local-kind:images
npm run test:unified-deploy:local-kind
npm run test:unified-deploy:existing-cluster-smoke -- --site-env=<existing-cluster-site-env> --substrate-truth=infra/deploy/unified/substrate/connection.env --public-base-url=<public-base-url>
```

### 3. 维护者排障 / 机器可读报告 Role Map

下面的 role table 用于理解证据所有权、排障和复核，不是要求新人手工维护第二套命令顺序。

| Role | Surface | 必须证明什么 |
| --- | --- | --- |
| human release entry | `npm run release:ready` | precheck 通过后进入 official campaign，并在结束后生成 summary |
| status reader | `npm run release:status` | 读取 latest/summary 指针；verdict 必须重新读取 campaign-scoped terminal result，不重新聚合 evidence |
| deploy evidence owner | `npm run test:unified-deploy:local-kind:images` + `npm run test:unified-deploy:local-kind` | 本机 K8s profile 镜像 handoff、rollout、ingress route smoke |
| deploy smoke owner | `npm run test:unified-deploy:existing-cluster-smoke` | 目标集群在 scope 内时显式执行 existing-cluster profile deploy、rollout、routing smoke |
| product evidence owner | focused `npm run test:unified-deploy:product-flows` | 最小产品链：project、files、managed runner task |
| preflight | internal adapter `gate:fast` | 基础 contract、static、cheap checks 没先坏 |
| tier verdict | internal adapter `gate:default` | 默认工程门禁通过；它不能代替 full visual |
| evidence owner | internal adapter `lane:visual` | full visual 与 `visual_scene_catalog` 完整 |
| evidence owner | internal adapter `gate:release` / `lane:backend-real:release` | release-grade backend-real 与 `ux_trace_bundle` 完整 |
| evidence owner | unified deploy producers | 默认 campaign 需要 substrate reset、local-kind images、local-kind rollout、focused product-flow 证据完整；existing-cluster smoke 是显式目标集群证据 |
| terminal verdict | internal verifier `gate:release:full` | aggregate-only 复核已有 campaign evidence，不执行任何 suite |

说明：
1. `gate:default` 只覆盖默认业务链与治理门禁，以及它们自己的 targeted visual。
2. `lane:visual` 是 full visual 证据 owner，不能被 `gate:default` 代替，并且它承担 `visual_scene_catalog` 证据所有权。
3. `gate:release` / `lane:backend-real:release` 承担 release-grade `ux_trace_bundle` 证据所有权。
4. unified deploy 的 `local-kind` 与 `existing-cluster` 是同一部署模型的 profile；默认 release campaign 用 local-kind 做本机发布证明，目标集群验收再显式补 existing-cluster smoke。route smoke 不能替代 focused product-flow 证据。
5. 如果某条 focused 测试、targeted lane 或 backend-real 局部命令通过，只能说明对应诊断切片恢复了，不能替代 `npm run release:ready`。

### 4. CI Green 的含义（机器可读报告）

CI green 不是完整 release sign-off：

1. PR 默认 CI 代表 `gate:fast` 和 `gate:default` 对应的内部 CI surfaces 通过。
2. `lane:visual` 在 push 或手动 workflow dispatch 时运行，并且在 CI 图里只依赖 `gate:fast`，不需要等待 `gate:default` 才开始。
3. `lane-backend-real-core` 仍然是手动 dispatch，并且依赖 backend-real secret。
4. release-grade sign-off 仍然必须看 `npm run release:ready` 产生的 campaign evidence、`lane:visual`、backend-real release、unified deploy evidence、terminal aggregate verdict 与 `summary.md`。

### 5. 手工 Feishu 联调步骤

当当前 release scope 明确包含 Feishu 联调或 Feishu 访问入口验收时，再执行：

```bash
make manual-feishu-admin
make manual-feishu-check
make manual-feishu-user
make manual-feishu-check
```

说明：
1. 这组步骤属于 operator 手工联调，不属于 automated gate。
2. 它们可以作为 release sign-off 的补充条件，但不能替代 `npm run release:ready`。
3. 如果这里失败，应在 release 结论中单独记录为手工集成阻塞，而不是改写 automated gate truth。

## 当前证据路径

### Official Campaign-Scoped Machine-Readable Reports

`npm run release:ready` 通过 precheck 后会产生 canonical release evidence root：

```text
artifacts/release-runs/<campaign-run-id>
```

在下面示例里用 `<campaign-root>` 表示这个目录。最终 release 结论必须优先看 campaign-scoped evidence，而不是看 standalone lane 上一次留下的默认 artifacts。

- terminal aggregate verdict：
  - `<campaign-root>/gate-release-full/result.json`
  - `<campaign-root>/gate-release-full/evidence.json`
- release summary：
  - `<campaign-root>/summary.json`
  - `<campaign-root>/summary.md`
  - `artifacts/release-runs/latest.json`
- full visual scene catalog and release campaign visual evidence：
  - `e2e/visual-baseline-support.ts`
  - `e2e/__screenshots__/visual.spec.ts`
  - `<campaign-root>/lane-visual/native/result.json`
  - `<campaign-root>/lane-visual/evidence.json`
  - `<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json`
  - `<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<scenario-id>/automated-pass.md`
  - `<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<scenario-id>/review.md`（独立 UX/UI review runbook）
- release backend-real review and trace evidence：
  - `<campaign-root>/gate-release/native/result.json`
  - `<campaign-root>/gate-release/evidence.json`
  - `<campaign-root>/gate-release/backend-real-visual/review.md`
  - `<campaign-root>/gate-release/backend-real-visual/ux-traces/<lane>/<suite>/<story-id>/<run-id>/review.md`
  - `<campaign-root>/gate-release/backend-real-visual/ux-traces`
- unified deploy evidence：
  - `<campaign-root>/lane-unified-deploy-substrate/native/result.json`
  - `<campaign-root>/lane-unified-deploy-local-kind-images/native/result.json`
  - `<campaign-root>/lane-unified-deploy-local-kind/native/result.json`
  - `<campaign-root>/lane-unified-deploy-product-flows/native/result.json`
  - `<campaign-root>/unified-deploy/substrate/*.json`
  - `<campaign-root>/unified-deploy/local-kind-images/*.json`
  - `<campaign-root>/unified-deploy/local-kind/*.json`
  - `<campaign-root>/unified-deploy/product-flows/*.json`

`gate:release:full` 会按当前 `CURRENT_VERIFICATION_CAMPAIGN_MANIFEST` 的 `evidenceChecks` 重新计算这些证据是否存在，并校验 wrapper/native `result.json` 的 `schema_version`、`gate_id`、`line_kind`、`gate_adapter.npm_script`、`evidence_dir` 和 `failure_class`。旧格式 `evidence.json` 只写 dummy `required_paths`，或者缺少当前 required check id，都不能得到绿色 release verdict。

### Standalone Lane Evidence

下面路径只表示单独运行某个 lane/gate adapter 时的默认产物位置，可用于诊断或人工查看；它们不能替代 `npm run release:ready` 产生的 campaign-scoped evidence。

- standalone backend-real visual review：
  - `artifacts/backend-real-visual/<run-id>/review.md`
  - `artifacts/backend-real-visual/<run-id>/ux-traces/<lane>/<suite>/<story-id>/<run-id>/review.md`
  - `artifacts/backend-real-visual/<run-id>/ux-traces`
- standalone unified deploy evidence：
  - `artifacts/unified-deploy/`
  - existing-cluster smoke remains standalone/operator-scoped unless a future campaign explicitly targets an existing cluster

## 当前 Story Evidence 真相（机器可读报告）

- `visual_scene_catalog`
  - owner: `test:visual`, `lane:visual`
  - source: `e2e/visual-baseline-support.ts`
- `ux_trace_bundle`
  - owner: `gate:release`, `lane:backend-real:release`
  - release campaign root: `<campaign-root>/gate-release/backend-real-visual/ux-traces`
  - standalone diagnostic root: `artifacts/backend-real-visual/<run-id>/ux-traces`

## 失败时的处理原则

如果门禁失败：
1. 只修阻塞发布的问题。
2. 不顺带扩新功能。
3. 如果是 visual 差异，先确认是否为真实 UX/UI 变更。
4. 只有在页面行为正确且变更合理时才更新基线。
5. 先判断这是 automated verdict 失败、evidence 缺失，还是手工联调失败；不要把不同层次的问题混成同一条结论。
6. focused 诊断命令只用于缩小范围；最终仍要回到 automated release-grade campaign 重新给出 verdict。

## 最终结论模板

发布结论只允许两种：
- `ready for release`
- `not ready for release`

如果 `not ready for release`，必须同时列出：
1. 阻塞项。
2. 失败命令或 failing internal adapter id。
3. 最小修复方向。
