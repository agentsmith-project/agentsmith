# JVS / AFSCP / AgentSmith Whole HOME Pre-GA One-Cut Fast Version-Control Plan v4

<!-- markdownlint-disable MD013 -->

Status: `handoff_ready`
Date: 2026-05-15
Owner: JVS / AFSCP / AgentSmith Files maintainers

## 1. 顶层硬约束

以下约束优先级高于后续 slice、contract 字段和实现建议；如果后文冲突，以本节为准。

- Pre-GA one-cut reset：AgentSmith、AFSCP、JVS 三个项目都能同步修改，必须作为一个同步重构切口一起改；接口 shape、CLI argv、JSON contract、operation model、UI consumer 都直接改到合理形态，不把任何 repo 的旧接口或旧调用方式当成不可变约束。
- No compatibility / no transition：不做旧接口兼容，不做逐步过渡，不保留双协议，不保留旧 preview / run / discard 心智，不为旧调用方预留 compatibility field / compatibility route / compatibility adapter。
- Tri-repo contract lockstep：JVS contract / binary、AFSCP runner / API contract、AgentSmith consumer / UI 必须引用同一个 `jvs.afscp.direct.v1` 版本；不能在任一 repo 内保留旧 active path 或双写 / 双读。
- Whole HOME product truth：AgentSmith 保存 / 恢复整个 file library HOME 是正确产品心智；绑定 Agent task 时就是整个 task HOME。后续不得为了性能把持久化范围缩小到 `workspace/`、白名单目录或“只保存用户可见文件”。性能问题只能在 JVS / AFSCP direct flow 内解决。
- Time budget first：JVS save / restore / list / status / doctor 的生产路径不得引入无谓运行时开销；不得做文件 / payload / content hash、digest、checksum、摘要或内容证明；不得做 HOME / payload tree walk、容量预检、payload tree sync、copy fallback、热路径压缩、save / restore 热路径 doctor / status。
- JVS scope：JVS 只做 JuiceFS-backed version control metadata、descriptor、history head、operation journal / recovery；文件操作和安全保证来自 JuiceFS 文件系统与 JuiceFS CLI clone 语义。
- JVS binary artifact identity：二进制发布制品身份只允许叫 `JVS binary artifact SHA-256` / `artifact_sha256`；这是 release artifact identity，只针对发布的 JVS binary artifact 计算，不得读取用户 HOME / payload，不得被写成 payload / content checksum。
- JVS control-root metadata marker boundary：若已有极小 control-root metadata marker，可继续覆盖 descriptor / journal / ready marker 这类小元数据；不得新增复杂机制或生产路径性能开销，不得读取或遍历 HOME / payload，不得作为文件内容 hash、content checksum 或安全内容证明，也不得进入 product API、direct JSON 或 OpenAPI。
- Contract hygiene：产品 API / UI 不暴露 JVS、JuiceFS、control root、内部路径、raw command、文件 / payload / content hash、digest、checksum、摘要、容量估算或内容证明字段。

同一 cut 必须同时收口：

- JVS implementation、CLI contract、tests、release binary。
- AFSCP runner、repoexec、operation model、OpenAPI / schema / contracts、JVS binary artifact SHA-256 (`artifact_sha256`) 配置、worker tests、evidence。
- AgentSmith API consumer、Files UI copy、contracts、real lane evidence。

只保护两件事：

- AgentSmith 产品语义：save point / restore 作用于整个 file library HOME；绑定 Agent task 时就是整个 task HOME；不得为性能缩小范围。
- AFSCP 面向 AgentSmith 的产品 API 清晰性：业务 API、鉴权、operation projection、审计字段必须稳定、可解释、不可泄露内部路径或凭据。

必须删除或禁止进入 active code / active contract：

- 旧 `restore-preview`、`restore_run`、restore discard plan lifecycle。
- 旧 JVS public `save_profile` 依赖。
- 旧应用层文件 / payload / content hash、digest、checksum、摘要、内容证明、文件树扫描、容量预扫描、payload tree sync、copy fallback、compression 热路径。
- 旧 contract 中用于证明 payload / content 内容的字段。
- restore 前自动保存当前 HOME、隐藏 save point、preview-run-discard 临时点。
- 为兼容、过渡、诊断或治理预留的慢路径 hook / flag / schema field。

## 2. 产品真相

whole HOME 不变：

- 文件库 save point 保存整个 file library HOME。
- 绑定 Agent task 时，file library HOME 就是 task HOME。
- `workspace/` 是 HOME 下普通目录和 agent / terminal 默认工作目录，不是 save / restore 范围边界。
- `.codex/`、`.cache/`、`.local/`、`workspace/` 等 HOME 下内容都属于预期保存和恢复范围。
- 这是 AgentSmith 正确产品心智，不是性能优化对象；后续不得为了性能缩小持久化范围，性能优化必须回到 JVS / AFSCP direct flow。

用户和 AgentSmith 不应看到：

- JVS、JuiceFS、control root、snapshot descriptor、ready marker、operation journal 等实现词。
- OS 系统目录式表述，例如容易误解的 `system folders`。
- 文件 / payload / content hash、digest、checksum、摘要、内容证明、文件树扫描、容量估算、payload sync 等内部实现词。

推荐产品文案口径：

- “整个文件库内容”
- “task HOME 内容”
- “HOME 下隐藏运行时目录”

## 3. 职责模型

AgentSmith：

- 表达 whole file library HOME / task HOME。
- 提供 save point list、create save point、direct restore 的产品交互。
- 不暴露 JVS、JuiceFS、control root、内部路径或内部命令。
- 不新增局部恢复 UI、DTO、user guide。

AFSCP：

- 拥有业务 API、鉴权、operation projection、审计、writer fence、错误映射。
- 调用 JVS direct contract，并把 JVS 结果规整为 AgentSmith 可消费的产品状态。
- 内部调用 JVS 时统一使用 `Target{ControlRoot, Home}`；AgentSmith 产品 API / UI 不暴露 control root。
- 不把 JVS 内部字段直接透传为产品 API。
- 不保留旧 preview / run / discard plan lifecycle 作为 active 心智。

JVS：

- 是 JuiceFS-backed version controller。
- 只管理版本元数据、snapshot descriptor、history head、operation journal / recovery。
- 文件操作和安全保证依赖 JuiceFS 文件系统与 JuiceFS CLI clone 语义。
- 不做文件 / payload / content hash、digest、checksum、摘要或内容证明。
- 不做文件树扫描。
- 不做容量预扫描。
- 不做 payload tree sync。
- 不做 copy fallback 慢路径。
- 不做 compression 热路径。

## 4. Fast Path 原则

时间开销是本计划最重要约束。JVS save / restore 的生产路径只做版本控制必需动作，不为了“看起来更安全”加入应用层重复校验或内容证明。
本节所有禁止项也约束 AFSCP / AgentSmith 的 active contract 和 active code；不得以兼容、过渡、诊断或治理名义绕过。

必须删除且不得在 active 生产路径出现：

- 遍历 HOME / payload 计算文件 / payload / content hash、digest、checksum、摘要或内容证明。
- 遍历 HOME / payload 做容量、文件数量或目录规模预扫描。
- 对 payload 做整棵树 sync。
- JuiceFS clone 不可用时自动退回递归 copy。
- save / restore 热路径压缩。
- save / restore 热路径默认追加 `doctor` / `status`，或把 `doctor` / `status` 作为默认前后置步骤 / 热路径串联。
- restore 前自动创建当前 HOME 的隐藏 save point 或 preview-run-discard 临时点。
- 在生产 JSON contract 中加入治理用计数器、文件样本、内部路径或命令回显。

只允许保留：

- 若已有极小 control-root metadata marker，可继续保留并只覆盖 descriptor / journal / ready marker 这些小元数据；不得为本计划新增复杂机制或性能开销。
- metadata-only `status` / `doctor` 命令，但只允许显式查询、CI smoke、失败诊断或已进入 recovery 后使用；不得由 save / restore 默认调用，不得作为 save / restore 默认前后置步骤或热路径串联。
- root-level selector validation 和 binding validation。
- 测试 fixture 的 deep compare，用来证明 whole HOME 行为。

边界说明：

- control-root metadata marker / descriptor metadata marker 只覆盖 control root 内的 JVS 元数据文件，不得触发 HOME / payload 遍历，不得成为文件内容 hash / content checksum / content proof，不得进入 product API、direct JSON 或 OpenAPI。
- 空间不足、clone 失败、rename 失败直接进入 operation failure 或 recovery，不做预扫描兜底。
- 生产 direct contract 要求 JuiceFS clone 可用；不可用 fail fast。
- 本 direct contract 不为压缩、容量评估、复制 fallback 等慢路径预留 flag、字段、hook 或 fallback 分支。

测试证据要求：

- 使用静态断言或 focused tests 证明生产 save / restore / list / status / doctor 路径不调用文件 / payload / content hash、digest、checksum、摘要、内容证明、文件树扫描、容量预扫描、payload tree sync、copy fallback、compression 相关 API。
- 使用 fake JuiceFS runner 或 real JuiceFS smoke 证明 save / restore 通过 JuiceFS clone 完成。
- 不为治理改动生产路径，不把测试观测字段放入生产 JSON contract。

## 5. Target Contract: `jvs.afscp.direct.v1`

定义新的 direct contract，只覆盖 AgentSmith 当前需要的 whole HOME 能力。
这是 pre-GA one-cut reset contract，不包含 legacy optional fields、兼容层、过渡层、双协议或旧 plan lifecycle。

Slice 0 的阻塞产物：

- 必须先产出 versioned contract 文档 / schema：`jvs.afscp.direct.v1`。
- 该 contract 必须包含 argv、required / optional JSON fields、status enum、error codes、exit code semantics、AFSCP error / status mapping。
- Slice 1-5 必须依赖这个 contract 实现和测试；不能并行猜字段或在各 repo 内各自定义 shape。

JVS active commands：

- `save`: whole HOME snapshot create。
- `list`: list save points / history head。
- `restore`: direct whole HOME restore to save point。
- `status`: metadata-only repository / operation status。
- `doctor`: metadata-only descriptor / journal / ready marker health。

Doctor / status boundary：

- 旧 `doctor --strict` 不进入 save / restore hot path。
- 生产 save / restore hot path 默认不追加 `doctor` / `status`；`doctor` / `status` 仅用于显式查询、CI smoke、失败诊断或已进入 recovery 后使用，且必须是 metadata-only；不得作为 save / restore 默认前后置步骤或热路径串联。
- 新 `doctor` / `status` 同样不得遍历 HOME / payload，不得触发文件 / payload / content hash、digest、checksum、摘要、内容证明、容量预扫描、payload tree sync 或 copy fallback。

最低 argv shape：

- AFSCP -> JVS 内部 argv 必须使用成对 selector：`--control-root <control_root_path>` 与 `--home <payload_home_path>` 同时出现。
- `workspace main` 固定在 direct v1 内部 binding，不暴露为可变 argv。
- `jvs afscp save --control-root <control_root_path> --home <payload_home_path> --message <message> --json`
- `jvs afscp list --control-root <control_root_path> --home <payload_home_path> --json`
- `jvs afscp restore --control-root <control_root_path> --home <payload_home_path> --save-point <save_point_id> --json`
- `jvs afscp status --control-root <control_root_path> --home <payload_home_path> --json`
- `jvs afscp doctor --control-root <control_root_path> --home <payload_home_path> --json`

Selector validation rules：

- `--control-root` 和 `--home` 都必须是 clean absolute path；JVS 重新 clean / canonicalize 后校验。
- 两个 root 互不相等、互不包含；`control_root_path` 不能在 `payload_home_path` 下，`payload_home_path` 也不能在 `control_root_path` 下。
- JVS 必须打开 control-root，并校验 `workspace main` binding 与 `home` canonical path 一致；不允许 list / status / doctor 凭空定位 repo。
- 如果 `--home/.jvs` 存在，必须 fail closed，避免把 control metadata 混入 payload HOME。
- `list` / `status` / `doctor` 可以做 root-level binding validation，但不得遍历 HOME / payload。
- direct JSON 不得回显 HOME、control root、raw command 或任何内部 path。

最低 status enum：

- `accepted`
- `running`
- `succeeded`
- `failed`
- `recovery_required`

最低 error codes：

- `JVS_INVALID_ARGUMENT`
- `JVS_LOCKED`
- `JVS_METADATA_INVALID`
- `JVS_SAVE_POINT_NOT_FOUND`
- `JVS_CLONE_UNAVAILABLE`
- `JVS_CLONE_FAILED`
- `JVS_JOURNAL_RECOVERY_REQUIRED`
- `JVS_INTERNAL`

Exit code semantics：

- `0`: command succeeded and JSON result is complete。
- `1`: internal error or unexpected failure。
- `2`: invalid argument / invalid invocation。
- `3`: metadata invalid or recovery required。
- `4`: lock busy / retryable concurrent mutation。
- `5`: JuiceFS clone / storage operation failed。

AFSCP mapping：

- `0` -> operation `succeeded` or accepted projection from JSON status。
- `2` -> terminal failed with validation error。
- `3` -> `recovery_required` or terminal failed when recovery is not possible。
- `4` -> retryable operation failure / in-progress conflict。
- `5` -> operation failure with clone / storage reason and audit correlation。
- malformed JSON -> terminal failed and JVS runner diagnostic。

从 active contract 移除：

- `restore-preview`
- `restore_run`
- restore discard
- preview plan id / run command
- expected folder evidence
- payload / content proof fields / file / payload / content hash / digest / checksum fields
- public `save_profile` 作为 AFSCP 依赖
- hidden save point / restore 前自动保存当前 HOME

JVS direct JSON 只应表达：

- operation status: accepted / running / succeeded / failed / recovery_required。
- save point identity: save_point_id、created_at、message、history_head。
- restore identity: restored_save_point_id、previous_head、new_head。
- metadata recovery state: journal phase、recoverable action、operator-safe reason。
- optional diagnostics: stable error code、retryable flag、operator-safe message。

JVS direct JSON 不应表达：

- payload file samples。
- HOME path、control root、raw command、JuiceFS internal path 或任何内部 path。
- 文件 / payload / content hash、digest、checksum、摘要、内容证明、容量估算、payload tree sync detail。

## 6. 开发 Slices

### Slice 0: Direct Contract Reset

目标：冻结 `jvs.afscp.direct.v1`，一次性替换旧 active contract；不设计兼容、过渡、双协议或双写 / 双读路径。

JVS：

- 定义 direct save / list / restore / status / doctor 的 versioned CLI 和 JSON schema。
- 写清 argv、required / optional JSON fields、status enum、error codes、exit code semantics、AFSCP error / status mapping。
- 冻结成对 selector：`Target{ControlRoot, Home}` 映射为 `--control-root <control_root_path>` + `--home <payload_home_path>`；save / list / restore / status / doctor 全部必传。
- 定义 clean absolute path、互不相等 / 互不包含、`--home/.jvs` fail closed、control-root binding validation、direct JSON 不回显路径 / raw command 的规则。
- 删除 active docs 中 restore preview / run / discard 作为主路径的描述。
- 删除 active schema 中 expected folder evidence、payload / content proof fields、file / payload / content hash / digest / checksum fields、public `save_profile` 依赖。
- 若已有极小 control-root metadata marker，可继续保留并覆盖 descriptor / journal / ready marker 这类小元数据；不得读取 HOME / payload，不得进入 product API、direct JSON 或 OpenAPI，不得形成新的复杂机制或性能开销。

AFSCP：

- runner 改为只调用 direct save / list / restore / status / doctor。
- worker / runner 统一从内部配置解析 `Target{ControlRoot, Home}`，对每个 direct command 同时传 `--control-root` 和 `--home`。
- AgentSmith 面向产品的 API、OpenAPI、UI copy 不出现 control root；control root 只存在于 AFSCP 内部配置和 JVS direct argv。
- operation model 删除 preview plan、run plan、discard plan 生命周期。
- OpenAPI / schema / contracts 同步 direct operation projection。

AgentSmith：

- Files UI 只表达 save point 和直接恢复。
- 移除 restore preview / run 用户心智。
- 不实现 restore 前自动保存当前 HOME 或隐藏 save point。

Dependency gate：

- Slice 1-5 开工前必须引用 `jvs.afscp.direct.v1` 的具体版本。
- 任何字段变更先更新 contract，再更新 JVS / AFSCP / AgentSmith 实现和测试。

TDD / 验收：

```bash
cd /home/percy/works/mbos-v1/jvs
go test -count=1 ./internal/... ./pkg/...

cd /home/percy/works/mbos-v1/agentsmith-fs-control-plane
go test -count=1 ./internal/jvsrunner ./internal/repoexec ./internal/api ./internal/workerapp
go run ./cmd/afscp-contract-verify -openapi api/openapi/internal-v1.openapi.yaml -schema api/schemas/afscp-internal-v1.schema.json -api-contract docs/contracts/afscp-internal-api-v1.md -api-draft docs/API_CONTRACT_DRAFT.md
```

Negative grep 必须作为验收项：active docs / API / schema / code 不再保留旧 active 心智或慢路径入口。

```bash
cd /home/percy/works/mbos-v1
rg -n "restore preview|restore-preview|restore_preview|restore-run|restore_run|RestorePreview|RestoreRun|restore_plan|hidden save point|隐藏 save point|restore.*save current|save current.*restore|save_profile|file content hash|content hash|file hash|content digest|payload digest|file checksum|content checksum|payload checksum|content proof|payload proof|文件内容摘要|copy fallback|CopyFallback|capacity scan|capacity estimate|capacity preflight|tree walk|tree scan|FsyncTree|compression hot path" jvs agentsmith-fs-control-plane agentsmith
```

验收标准：三 repo 都要覆盖。命中只能出现在 removed list、historical evidence、allowlist 或本计划引用中；active contract / active code 不能依赖它们。

注意：裸 `rg` 无命中会 exit 1，不适合作为唯一验收。需要一个 allowlist 脚本区分 historical evidence / removed list / active code，脚本输出 active 命中数为 0。

### Slice 1: Metadata-Only Snapshot Layout

目标：payload 和 JVS metadata 分离，payload 目录只放 HOME 内容。

JVS layout：

- snapshot payload tmp / published payload 只包含 whole HOME 内容。
- descriptor、ready marker、history head、operation journal 放在 payload 外。
- ready marker 只校验 `snapshot_id` 和 descriptor metadata marker；descriptor metadata marker 只代表 descriptor metadata，不代表 payload / content 校验，也不得进入 product API、direct JSON 或 OpenAPI。
- descriptor metadata marker 只覆盖 descriptor metadata，不读取 HOME / payload。
- 不存在 payload / content hash、digest、checksum、摘要或内容证明字段。

JVS recovery：

- descriptor / ready marker mismatch fail closed。
- history head 指向不存在 descriptor 时进入 recovery_required。
- orphan payload 只允许做 journal / metadata referenced cleanup，且必须在 save / restore hot path 之外执行；不得实现后台 payload tree scan、容量统计或治理型 GC。

TDD / 验收：

```bash
cd /home/percy/works/mbos-v1/jvs
go test -count=1 ./internal/snapshot ./internal/recovery ./internal/doctor ./internal/cli -run 'Test.*(Descriptor|Ready|Journal|Metadata|Orphan|Doctor).*'
```

验收标准：

- payload 目录中没有 JVS metadata。
- descriptor / ready mismatch fail closed。
- control-root metadata marker / descriptor metadata marker 不遍历 HOME / payload，不成为 content proof，不进入 product API、direct JSON 或 OpenAPI。
- 静态断言生产路径不调用文件 / payload / content hash、digest、checksum、摘要、内容证明、文件树扫描、容量预扫描、payload tree sync、copy fallback、compression 相关 API。

### Slice 2: JVS Save Fast Path

目标：save 只做版本控制必要工作，时间开销最低。

Save flow：

1. Acquire JVS mutation lock and write save intent journal.
2. Resolve whole HOME boundary.
3. `juicefs clone HOME -> snapshot payload tmp`.
4. Atomic publish snapshot payload.
5. Write descriptor / ready marker / history head metadata.
6. Mark journal complete.

禁止：

- 文件 / payload / content hash、digest、checksum、摘要或内容证明。
- 文件树扫描。
- 容量预扫描。
- payload tree sync。
- compression。
- copy fallback。

生产要求：

- JuiceFS clone 必须可用。
- JuiceFS clone 不可用时 fail fast，operation 失败并输出可恢复 / 可重试的产品安全错误。

TDD / 验收：

```bash
cd /home/percy/works/mbos-v1/jvs
go test -count=1 ./internal/snapshot ./internal/cli ./internal/recovery -run 'Test.*(Save|JuiceFS|Journal|WholeHome|FastPath).*'
```

Fast-path evidence：

- 静态断言 save 生产路径不调用文件 / payload / content hash、digest、checksum、摘要、内容证明、文件树扫描、容量预扫描、payload tree sync、copy fallback、compression 相关 API。
- fake JuiceFS runner 或 real smoke 证明 save 调用 `juicefs clone`，且不存在 copy fallback 分支。

Atomicity / recovery tests：

- save intent 失败不进入 history。
- payload publish 后 history 失败只能通过 journal / metadata referenced cleanup 收敛 orphan，且不进入 save / restore hot path。
- descriptor / ready 写失败不产生可见 save point。
- journal complete 后 list 能看到 save point。

Whole HOME tests：

- fixture 包含 `workspace/`、`.codex/`、`.cache/`、`.local/`、symlink、empty dir。
- workspace-only 实现必须失败。
- 过滤 dot folder 的实现必须失败。

### Slice 3: JVS Direct Restore Fast Path

目标：restore 直接用 JuiceFS clone 恢复 whole HOME，不做 preview materialization。

Restore flow：

1. Metadata source check: save point descriptor / ready / history relation。
2. Acquire JVS mutation lock and write restore intent journal。
3. `juicefs clone snapshot payload -> restore tmp`。
4. Prepare journal-scoped atomic replace / rollback staging with JuiceFS / filesystem directory-level rename / swap primitives only。
5. Keep HOME root stable and atomically replace managed HOME contents / managed entries with restore tmp，且仅使用 JuiceFS / filesystem directory-level clone、rename、replace/swap 原语。
6. Update head / restore metadata。
7. Cleanup staging or leave recoverable journal。
8. Mark journal complete。

职责边界：

- AFSCP 持有 writer fence、业务鉴权、审计和 operation projection。
- JVS 只持有 JVS mutation lock、metadata journal 和 recovery state。
- JVS 不替换 HOME root inode，避免破坏 mount、cwd、task HOME 引用。
- JVS 不在 restore 前创建当前 HOME 的 product save point；rollback staging 只能是 journal-scoped recovery state，不进入 history / list / product API。
- restore replace / swap 必须依赖 JuiceFS / filesystem 提供的目录级 clone、rename、replace / swap 原语；如果需要应用层递归 tree walk / delete / sync 才能实现，说明模型不对，必须 fail / 重设模型，不允许实现慢路径；不得实现 payload sync、copy fallback 或容量统计。

禁止：

- payload / content hash、digest、checksum、摘要或内容证明。
- preview materialization。
- capacity estimate。
- 文件树扫描。
- copy fallback。
- restore 前自动保存当前 HOME 或创建 hidden save point。

TDD / 验收：

```bash
cd /home/percy/works/mbos-v1/jvs
go test -count=1 ./internal/restore ./internal/recovery ./internal/cli -run 'Test.*(DirectRestore|Restore|Rollback|Journal|WholeHome|FastPath).*'
```

Fast-path evidence：

- 静态断言 restore 生产路径不调用文件 / payload / content hash、digest、checksum、摘要、内容证明、文件树扫描、容量预扫描、payload tree sync、copy fallback、compression 相关 API。
- fake JuiceFS runner 或 real smoke 证明 restore 调用 `juicefs clone`，且不存在 copy fallback 分支。

Atomicity / recovery tests：

- restore replace staging 后失败可 rollback。
- payload replace 后 head 更新失败进入明确 recovery。
- journal recovery 能区分 before_replace、after_replace_before_head、complete。
- descriptor / ready mismatch fail closed。

Whole HOME tests：

- restore 后 `.codex/`、`.cache/`、`.local/`、`workspace/` 都来自目标 save point。
- delete files 后 restore 能恢复 HOME，并移除 save point 之后新增的 HOME 内容。

### Slice 4: AFSCP Adapter Rewrite

目标：AFSCP 只承载 direct save / list / restore / status / doctor，不保留旧 plan lifecycle。

AFSCP implementation：

- `internal/jvsrunner` 改为 direct runner。
- `internal/workerapp` / worker operation 只接收 AFSCP 内部解析后的 `Target{ControlRoot, Home}`，不从 list / status / doctor 的缺省 argv 反推 repo。
- `internal/repoexec` save / restore executor 改为 direct operation。
- direct save / list / restore / status / doctor 全部通过 runner 同时传 `--control-root` 与 `--home`。
- runner 对两个 root 先做 clean absolute path 校验，再把成对 selector 传给 JVS；JVS 仍必须重新校验。
- operation record 删除 preview/run/discard 状态机。
- 删除旧 restore preview / run / discard handler routes。
- 删除旧 operation phases、store tables / fields、contract verifier fixtures；如数据库迁移需要保留历史列，active code 不再读写。
- operation projection 只暴露产品安全字段：operation id、status、target save point、timestamps、retryable reason、audit correlation；不回显 HOME、control root、raw command 或内部 path。
- writer fence、鉴权、审计继续由 AFSCP 负责。
- JVS binary artifact SHA-256 (`artifact_sha256`) / Dockerfile / ADR / readiness evidence 同一 cut 更新到新 JVS binary。
- 修正 AFSCP explorer 旧建议：direct save / restore 与 list / status / doctor 一样，统一使用 `Target{ControlRoot, Home}`。

Contracts / docs：

- 更新 OpenAPI、JSON schema、AFSCP contracts。
- `docs/contracts/jvs-runner-contract-v1.md` 改为 direct contract 或新版本。
- runner contract 明确 `--control-root` / `--home` 为 save / list / restore / status / doctor 的必填 argv，`workspace main` 不作为可变参数。
- AgentSmith product API / UI contract 不出现 control root、HOME path、raw command 或 JVS internal path。
- `docs/adr/0009-jvs-runner-pin.md` 更新 active JVS binary artifact SHA-256 (`artifact_sha256`)。
- `docs/JVS_PIN_EVIDENCE_*.md` 和 `docs/READINESS_EVIDENCE.md` 记录新 direct-capable binary 的 JVS binary artifact SHA-256 (`artifact_sha256`)。

TDD / 验收：

```bash
cd /home/percy/works/mbos-v1/agentsmith-fs-control-plane
go test -count=1 ./internal/jvsrunner ./internal/repoexec ./internal/api ./internal/workerapp ./internal/contractcheck
go run ./cmd/afscp-contract-verify -openapi api/openapi/internal-v1.openapi.yaml -schema api/schemas/afscp-internal-v1.schema.json -api-contract docs/contracts/afscp-internal-api-v1.md -api-draft docs/API_CONTRACT_DRAFT.md
```

Negative grep：

```bash
cd /home/percy/works/mbos-v1
rg -n "restore preview|restore-preview|restore_preview|restore-run|restore_run|RestorePreview|RestoreRun|restore_plan|hidden save point|隐藏 save point|restore.*save current|save current.*restore|save_profile|file content hash|content hash|file hash|content digest|payload digest|file checksum|content checksum|payload checksum|content proof|payload proof|文件内容摘要|copy fallback|CopyFallback|capacity scan|capacity estimate|capacity preflight|tree walk|tree scan|FsyncTree|compression hot path" jvs agentsmith-fs-control-plane agentsmith
```

验收标准：

- active API / schema / code 不再依赖旧 plan lifecycle。
- JVS runner 不解析文件 / payload / content hash、digest、checksum、摘要或内容证明字段。
- AFSCP operation projection 不包含 JVS internal path、HOME、control root、raw command、文件 / payload / content hash、digest、checksum、摘要、内容证明、容量估算。
- allowlist 脚本确认 active 命中数为 0，historical evidence / removed list 不阻塞。
- 静态断言 AFSCP direct runner 不引入 copy fallback、容量预扫描、文件树扫描或 payload tree sync。

### Slice 5: AgentSmith Consumer Cleanup

目标：AgentSmith 只表达 whole 文件库保存点与直接恢复。

AgentSmith implementation：

- Files UI save point list / create / restore 对接 AFSCP direct API。
- 删除 restore preview / run copy、状态、按钮、测试心智。
- restore confirm 只调用 direct restore。
- 静态断言和 E2E 必须证明不会调用 restore-preview、restore-run、restore-cancel，不会创建 hidden save point 或 restore 前自动保存当前 HOME。
- 错误文案只表达文件库操作失败、可重试、需要稍后再试或联系管理员。
- 不暴露 JVS / JuiceFS / control root / internal path / 文件 / payload / content hash、digest、checksum、摘要、内容证明 / 容量估算。

Contracts / docs：

- 更新 AgentSmith Files contracts。
- 修正旧句子：Files 默认打开 file library HOME root，不是 `workspace/`。
- 用户文档继续说明 restore 覆盖整个文件库内容；conversation / traces 不随文件 restore 回滚。

TDD / 验收：

```bash
cd /home/percy/works/mbos-v1/agentsmith
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
npm run verify -- --goal=pr --run
```

当前如果已有 governance manifest blocker，先记录 baseline 或先修 blocker，不能把旧 blocker 归因到本计划。

E2E user story：

1. 创建 file library / task HOME。
2. 写入 `workspace/` 文件和 `.codex/`、`.cache/`、`.local/` 标记文件。
3. 创建 save point。
4. 删除文件并新增 save point 之后的 HOME 内容。
5. direct restore 到 save point。
6. 验证 whole HOME 恢复，新增内容被移除。
7. Agent task 继续工作，terminal / runner 看到同一 HOME。

## 7. Cross-Repo Real Smoke

同一 cut 的真实 smoke：

1. 从同一 JVS commit build binary。
2. AFSCP 配置该 binary path 和 JVS binary artifact SHA-256 (`artifact_sha256`)。
3. AFSCP runner direct save / list / restore / status / doctor smoke 通过，且每个 command 都包含 `--control-root` 与 `--home`。
4. 证明真实 `juicefs clone` 被调用，且不存在 copy fallback 分支。
5. AgentSmith real lane 完成 savepoint -> delete files -> restore -> agent task 继续工作。

Gate 分层：

- Mocked fast gate：没有本地 JuiceFS 时，使用 fake JuiceFS runner 证明 argv、operation mapping、禁止 fallback 行为。
- Real JuiceFS gate：有本地 JuiceFS 时，必须跑真实 `juicefs clone`，证明 save / restore 都走 clone 路径。
- Static guard：三 repo active 生产路径不调用文件 / payload / content hash、digest、checksum、摘要、内容证明、文件树扫描、容量预扫描、payload tree sync、copy fallback、compression 相关 API。

建议命令：

```bash
cd /home/percy/works/mbos-v1/jvs
make build

cd /home/percy/works/mbos-v1/agentsmith-fs-control-plane
go test -count=1 ./internal/jvsrunner ./internal/repoexec ./internal/workerapp -run 'Test.*(Direct|Save|Restore|JVS).*'
bash scripts/verify-ga-baseline.sh

cd /home/percy/works/mbos-v1/agentsmith
npm run verify -- --goal=real --run
```

如果 real lane 当前已有非本计划 blocker，记录 blocker 和 baseline；修复 blocker 后再签署本计划。

## 8. 风险与回滚

风险：移除应用层文件内容扫描 / hash / digest / checksum / content proof 后，团队误解为“降低安全”。

- 正确表述：JVS 不用应用层重复扫描来补安全；安全边界来自 JuiceFS 文件系统与 JuiceFS CLI clone 语义、JVS control-root metadata fail-closed 状态机、operation journal、可恢复记录。
- 验收：control-root metadata mismatch fail closed、journal recovery tests、whole HOME real smoke、静态断言无生产路径慢 API。

风险：JuiceFS clone 不可用。

- 正确表述：生产 direct contract 要求 JuiceFS clone 可用，不可用 fail fast。
- 不引入 copy fallback 慢路径。
- 回滚方式：回滚整套 direct contract cut 或修复 JuiceFS clone 环境；不在 JVS 内追加慢 fallback。

风险：空间不足。

- 正确表述：空间不足作为 JuiceFS clone / rename 错误进入 operation failure / recovery，不做预扫描。
- 验收：clone failure 映射为 AFSCP retryable / terminal operation 状态，审计可追踪。

风险：replace HOME 后失败。

- 控制：restore journal 明确 before_replace、after_replace_before_head、complete。
- 控制：rollback staging 是 journal-scoped recovery state，不是 restore 前自动保存当前 HOME，也不是 product save point。
- 验收：managed HOME contents replace 后 head 更新失败进入明确 recovery；operator 或自动 recovery 能收敛。

风险：三项目同 cut 漏改。

- 控制：JVS binary、JVS binary artifact SHA-256 (`artifact_sha256`)、OpenAPI/schema/contracts、AgentSmith consumer tests 必须在同一 PR train 或同一 release branch 收口。
- 验收：Cross-Repo Real Smoke 通过。

## 9. Handoff Checklist

Global one-cut：

- [ ] AgentSmith、AFSCP、JVS 在同一 cut 引用同一个 `jvs.afscp.direct.v1` contract。
- [ ] 没有旧接口兼容、逐步过渡、双协议、双写 / 双读或 compatibility adapter。
- [ ] AgentSmith whole HOME 产品心智保持不变；没有为了性能把持久化范围缩小到 `workspace/`、白名单目录或“只保存用户可见文件”。
- [ ] 性能问题只在 JVS / AFSCP direct flow 解决，不通过缩小 AgentSmith 保存范围解决。
- [ ] JVS binary artifact identity 统一写作 `JVS binary artifact SHA-256` / `artifact_sha256`，且明确是 release artifact identity，只针对发布的 JVS binary artifact，不读取 HOME / payload。
- [ ] 若已有极小 control-root metadata marker，可继续只覆盖 descriptor / journal / ready marker 小元数据；不读取 HOME / payload，不进入 product API、direct JSON 或 OpenAPI，不成为新性能开销或新复杂机制。
- [ ] payload / content / file hash、digest、checksum、摘要、内容证明在 active contract / active code / 产品 API / UI 中均为禁止项。

JVS：

- [ ] `jvs.afscp.direct.v1` 已定义并成为 active contract。
- [ ] Contract 包含 argv、required / optional JSON fields、status enum、error codes、exit code semantics、AFSCP error / status mapping。
- [ ] save / list / restore / status / doctor 的最低 argv 全部要求 `--control-root` 与 `--home` 成对出现。
- [ ] `workspace main` 固定在 direct v1 内部 binding，不暴露可变 argv。
- [ ] 两个 root 均为 clean absolute path，互不相等 / 互不包含；`--home/.jvs` 存在时 fail closed。
- [ ] JVS 打开 control-root 并校验 main workspace binding 与 home canonical path 一致。
- [ ] Slice 1-5 引用同一个 versioned contract，没有各自猜字段。
- [ ] 没有旧接口兼容、逐步过渡、双协议或旧 plan lifecycle active 路径。
- [ ] 生产 runtime 不对 HOME / payload 做文件 / payload / content hash、digest、checksum、摘要或内容证明。
- [ ] 生产 runtime 不对 HOME / payload 做文件树扫描或容量预扫描。
- [ ] 生产 runtime 不对 payload 做整棵树 sync。
- [ ] 生产 runtime 不包含 copy fallback 慢路径。
- [ ] 生产 runtime 不包含 compression 热路径。
- [ ] save 使用 `juicefs clone`。
- [ ] restore 使用 `juicefs clone`。
- [ ] metadata-only doctor / status 只允许显式查询、CI smoke、失败诊断或已进入 recovery 后使用；不作为 save / restore 默认前后置步骤或热路径串联，不遍历 HOME / payload，不触发文件 / payload / content hash、digest、checksum、摘要、内容证明、容量预扫描、payload tree sync 或 copy fallback。
- [ ] list / status / doctor 只允许 root-level binding validation，不遍历 HOME / payload。
- [ ] descriptor / ready / journal metadata mismatch fail closed。
- [ ] restore 不在前置步骤自动保存当前 HOME，不创建 hidden save point。
- [ ] 静态断言生产路径不调用文件 / payload / content hash、digest、checksum、摘要、内容证明、文件树扫描、容量预扫描、payload tree sync、copy fallback、compression 相关 API。
- [ ] whole HOME fixture 覆盖 `workspace/`、`.codex/`、`.cache/`、`.local/`、symlink、empty dir。
- [ ] workspace-only 或过滤 dot folder 的实现会失败。

AFSCP：

- [ ] runner 只承载 direct save / list / restore / status / doctor。
- [ ] worker / runner 统一使用 `Target{ControlRoot, Home}`，所有 direct command 同时传 `--control-root` 与 `--home`。
- [ ] operation model 删除 preview/run/discard plan lifecycle。
- [ ] 旧 restore preview / run / discard handler routes 已删除。
- [ ] 旧 operation phases、store tables / fields、contract verifier fixtures 已删除或不再 active 使用。
- [ ] OpenAPI / schema / contracts 删除旧 preview 字段和旧内容证明字段。
- [ ] JVS binary artifact SHA-256 (`artifact_sha256`) / Dockerfile / ADR / readiness evidence 指向新 binary。
- [ ] operation projection 不暴露 JVS / JuiceFS / control root / HOME / raw command / internal path / 文件 / payload / content hash、digest、checksum、摘要、内容证明 / 容量估算。
- [ ] writer fence、鉴权、审计仍由 AFSCP 负责。
- [ ] 静态断言 direct runner 不引入文件树扫描、容量预扫描、payload tree sync、copy fallback 或 compression 热路径。

AgentSmith：

- [ ] Files UI 只表达 save point 与直接恢复。
- [ ] restore copy 明确 whole 文件库内容 / task HOME 内容。
- [ ] 无 restore preview / run 用户心智。
- [ ] restore confirm 只调用 direct restore，不调用 restore-preview / restore-run / restore-cancel / hidden save point。
- [ ] restore 不会为了恢复前当前状态创建自动 save point。
- [ ] 产品 API / UI 无 JVS / JuiceFS / control root / internal path / 文件 / payload / content hash、digest、checksum、摘要、内容证明 / 容量估算文案。
- [ ] whole HOME E2E user story 通过。

Cross-repo：

- [ ] 同一 JVS commit build binary。
- [ ] AFSCP 配置 JVS binary artifact SHA-256 (`artifact_sha256`) 并通过 focused runner / repoexec tests。
- [ ] Mocked fast gate 证明 direct argv、operation mapping、fallback 禁止行为。
- [ ] Real JuiceFS gate 证明真实 `juicefs clone` 被调用。
- [ ] Static guard 证明三 repo active 生产路径不调用文件 / payload / content hash、digest、checksum、摘要、内容证明、文件树扫描、容量预扫描、payload tree sync、copy fallback、compression 相关 API。
- [ ] AgentSmith real lane 完成 savepoint -> delete files -> restore -> agent task 继续工作。
- [ ] 三 repo allowlist guard 确认 active docs / API / schema / code 负向关键词命中数为 0。
