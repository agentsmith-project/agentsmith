# Release Kit 与 Runner Repo 拆分 Evidence Log v1

<!-- markdownlint-disable MD013 -->

Status: `reference-evidence-log`
Date: 2026-05-29
Source: [Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1](../release-kit-and-runner-repo-split-kiss-plan-v1.md)

本文只保存从 active 计划移出的交接证据和历史审查问题。它只读、非规范，不能替代当前 release-kit repo-local deployment/package/operator verdict，也不能把 focused diagnostic 写成 readiness。

## Previous Status Ledger

```text
Status: `p1_1_artifact_producer_passed_p2_online_target_registry_apply_evidence_spine_done_p2_registry_presence_focused_done_p2_operator_preloaded_registry_prereq_binding_done_operator_signoff_intake_guard_done_p3_airgap_bundle_render_check_done_p3_app_current_inventory_closure_done_p3_airgap_image_archive_materiality_focused_done_p3_airgap_image_load_import_focused_done_p3_airgap_deployment_focused_gate_done_p3_substrate_pack_focused_done_p3_substrate_routability_focused_done_p5_1_start_guard_done_p5_2_formal_artifact_handoff_done_p5_3a_runner_release_manifest_skeleton_done_agentsmith_p5_3a_machine_contract_alignment_done_p5_3b_runner_runtime_fast_first_half_done_p5_3b_projection_only_boundary_fix_done_p5_3b_runner_boundary_closure_done_p5_runner_image_smoke_done_p5_runner_publish_manifest_evidence_done_agentsmith_manifest_lock_adoption_done_release_contract_runner_digest_adoption_done_release_kit_managed_runner_image_closure_consumption_done_agentsmith_support_api_projection_consistency_done_p5_request_scoped_projected_dependencies_contract_env_wiring_done_p5_runner_image_task_execution_smoke_done_agentsmith_runner_projection_smoke_lock_truth_done_p2_kit_installed_online_deployment_composition_focused_done`
```

## Entry Evidence Snapshot

<details>
<summary>Evidence log snapshot（只读交接证据，非规范）</summary>

P0 machine guards passed; P1.1 CI release contract artifact
producer passed; release-kit input/evidence intake 已阶段性收口到 fail-fast
focused diagnostic。Full P1 adoption is not claimed. P4 AgentSmith runner
contract formal artifact producer/checker 已完成（AgentSmith commit
`d6648303`）；P5.0 runner repo consumer diagnostic skeleton 已完成并可消费
正式 artifact（runner repo commit `02feee8`）；P5.2 formal artifact handoff
已完成并验证（AgentSmith commit `fcecb85b`），只证明 AgentSmith producer
产物能被 runner repo consumer 消费；P5.3a runner release manifest
skeleton/checker/start-guard 集成已完成并可交接（runner repo commit
`7c43ba8 feat: add runner release manifest skeleton` 已推送到
`agentsmith-project/agentsmith-runner` main，remote CI run `26455289999`
success，jobs `Quick governance` 和 `Runner start guard` success）。AgentSmith
P5.3a machine contract alignment 已完成：release boundary schema、positive
runner release manifest fixture、runner image lock fixture 和 adoption checker
默认路径已对齐 runner repo P5.3a skeleton；positive lock fixture 已收敛到
`scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock`，
旧 `agent-task-runner-image.lock` 不再作为 positive fixture 保留，
`agent-task-runner` identity 只做负向测试。该切片仍不是 runtime migration、
image build/publish、真实 adoption 或 release readiness。P5.3b first half 已在
runner repo 完成并推进到 boundary closure：commit
`a6ddb50 fix: keep runner skills projection-only` 保留为 projection-only
builtin skills 修复事实；追加 commit
`fd6d851 fix: keep runner workspace contract-only` 已移除 runner runtime 对
workspace-access/file-library product API、AFSCP binding schema 和 release
fence payload 的依赖，`prepareTaskWorkspace` 只消费
`@mbos/agent-runner-contract` execution context/path fields，release no-op，
`agent.response.done` 不再伪造 `usage_tokens`；commit
`4dbbd26 fix: keep runner artifact scan policy-local` 已把 artifact scan 从
`.trash` / `.minio.sys` file-library reserved namespace policy 收敛为 runner
runtime/local tool roots filtering；commit
`7d21959 test: harden runner product boundary guard` 为当前 P5.3b boundary closure
runner HEAD，加固 `.trash`、`.minio.sys`、file-library reserved namespace、
`usage_tokens` 多种键/赋值形态、workspace-access/release fence 等 forbidden
patterns 的 guard/self-test。remote CI：`a6ddb50` run `26463276084` success；
`fd6d851` run `26465341186` success；`4dbbd26` run `26465733200` success；
`7d21959` run `26465985945` success。该切片让 runner repo 拥有
repo-local runtime source、builtin skills、root package/tsconfig/vitest、
source-boundary/product semantics guard、runtime fast focused diagnostic 和
clean-dependency start-guard guard。P5 focused image build/start smoke 已完成：
runner repo commit `b80ea3c feat: add runner image smoke gate`，remote CI run
`26468415599` success，jobs `Runner image smoke`、`Runner skeleton start guard`
和 `Quick governance` success；本地主控 evidence：`bash scripts/verify-release.sh --quick`
passed，`bash scripts/verify-release.sh --start-guard` passed，explicit artifact
root `/tmp/agentsmith-runner-contract-artifact.xxwfV1` 的 `--contract-consumer`
passed，`bash scripts/verify-release.sh --image-smoke --artifact-root /tmp/agentsmith-runner-contract-artifact.xxwfV1`
passed（Docker build 成功，missing env run exit 1 且 stderr 包含 `Usage`，
输出 `image smoke passed`），`git diff --check` passed。只读 review 无阻断；
两个 low consistency gap 已修复（ADR bootstrap 历史口径、PR template image smoke
checklist）。该切片不是 GHCR publish、不登录 registry、不生成 release manifest、
不产生 release manifest image digest、不更新 AgentSmith adoption lock、不改 release
contract runner digest、不是 release readiness，且不迁入 AgentSmith product semantics。
P5 runner focused image task-execution smoke 已完成：runner repo commit
`7a98d40 feat: add runner image task execution smoke`，remote CI run
`26616757307` success，jobs `Quick governance`、`Runner skeleton start guard` 和
`Runner image smoke` success；本地 evidence：
`bash scripts/verify-release.sh --quick`、`bash scripts/verify-release.sh --start-guard`、
`bash scripts/test-runner-runtime-fast.sh`、`npm run check:source-boundary`、
`bash -n scripts/verify-release.sh scripts/test-runner-image-task-execution-smoke.sh`、
`node --check scripts/runner-task-execution-smoke.mjs`、`git diff --check` 和
`bash scripts/verify-release.sh --image-task-execution-smoke --artifact-root /tmp/agentsmith-runner-contract-artifact.valid.caD2Wl`
passed。该 smoke 覆盖真实 built image `/app/dist/index.js` -> local WS harness ->
fake Codex -> artifact/done，且 build context 最小、sentinel scan fail-closed、
container early exit fail-fast。它已完成 fake-Codex focused task-execution image
smoke；仍不是 backend-real、真实 LLM、release readiness、AgentSmith adoption、
GHCR publish 或 full runtime semantics。
AgentSmith `--runner-projection-smoke` canonical lock truth 已完成 local focused
evidence passed：`npm run test:run -- scripts/internal-backend-real-gate-runtime.test.ts scripts/contracts/check-runner-image-lock.test.ts`
和 `npm run contracts:check-runner-image-lock`。该 smoke 未传
`INTEGRATION_INTERNAL_AGENT_IMAGE` 时自动使用
`scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock`
中的 digest image，并默认 `INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0`；
显式 image mismatch、legacy image/path 或 build 非 0 都 fail fast。未引入第二
lock path；它不是 release readiness、deploy verdict 或 package readiness。
P5 runner publish manifest focused evidence 已完成：runner repo 最终 HEAD
`8b2541d9e2b11b3b97481443b061cb7fbc952080`（short `8b2541d`）；final publish run
`26582224675`（workflow_dispatch，headSha
`8b2541d9e2b11b3b97481443b061cb7fbc952080`）成功，使用 AgentSmith contract
artifact package
`gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/26580019002/mbos-agent-runner-contract-0.1.0.tgz`，job `Publish digest-pinned runner image evidence`
成功完成 download AgentSmith artifact、contract consumer、no-push image smoke、
GHCR login、build/push image、resolve digest、write/verify manifest、upload
`runner-release-manifest`。产物 artifact id `7269115958`，size 1074 bytes；
published image ref 为
`ghcr.io/agentsmith-project/agentsmith-runner:release-p5-publish-8b2541d@sha256:26ba63e1e8c92ac9f8499c55bf4aeaf15c463f0e0682eee523268ee84b44fde7`；
workflow 生成 manifest 后本地 verify 并上传 artifact；manifest
`artifact_provenance.artifact_uri` 为
`gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/26582224675/runner-release-manifest.json`，
`subject_sha256` 为
`sha256:443ca4e58c9c7d71b4f0a4a8fc51f22c57eedbc8463d5a848fed118d3272be4a`，
`contract_artifact.package_uri` 为
`gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/26580019002/mbos-agent-runner-contract-0.1.0.tgz`。
该切片只是 focused publish evidence：不是 AgentSmith adoption lock、不是
release contract runner digest adoption、不是 release readiness、不是
backend-real、真实 LLM、full runtime semantics，也不是 release-kit airgap/online
deployment readiness。初始 push-side Runner Image Publish run `26470793744`
曾因 workflow heredoc YAML 缩进解析失败，后续已由 `68f6392` 修复，并通过
`26471096167`、`26471317913` 与最终 `26582224675` 验证；这只作为过程修复证据，
不是当前 blocker。`actions/download-artifact@v8.0.1` 仍有非阻断 `Buffer()`
deprecation log line，但 check annotations 为空且 final run 成功。
AgentSmith manifest/lock adoption 已完成：positive runner manifest fixture 已用
final publish run `26582224675` 的 `runner-release-manifest.json` 替换，
`release_id=p5-publish-8b2541d`，image digest 为
`sha256:26ba63e1e8c92ac9f8499c55bf4aeaf15c463f0e0682eee523268ee84b44fde7`，
manifest subject binding sha 为
`sha256:443ca4e58c9c7d71b4f0a4a8fc51f22c57eedbc8463d5a848fed118d3272be4a`；
canonical `agentsmith-runner-image.lock` 已从该 manifest 投影更新。本地 evidence：
`npm run test:run -- scripts/governance/__tests__/current-release-boundary-schema.test.ts scripts/contracts/check-runner-image-lock.test.ts scripts/contracts/check-release-boundary-contract.test.ts`
passed；`npm run contracts:check-runner-image-lock -- --adoption --manifest scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json`
passed；runner repo checker `node /home/percy/works/mbos-v1/agentsmith-runner/scripts/check-runner-release-manifest.mjs --manifest scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json`
passed；`npm run contracts:check-engineering-governance` passed；`npm run
contracts:check-doc-governance` passed；`git diff --check` passed。该切片只是
AgentSmith manifest/lock adoption：不是 release contract runner digest adoption，
不改 release-contract generator，不改 runtime，不代表 release readiness、
backend-real、真实 LLM、full runtime semantics 或 release-kit deployment readiness。
Release contract runner digest adoption 已完成：release contract input 只接受
结构化 `runnerImageLock`，`managed_runner_image` 顶层字段由 canonical lock 投影，
保留 runner artifact identity `agentsmith-runner`；同时
`deploy_image_inventory` 增加稳定 release inventory id `managed_runner`，
image/digest/source 绑定同一 lock image，`deploy_template_package.required_image_ids`
包含 `managed_runner`，模板包把 `MANAGED_RUNNER_IMAGE` 渲染为
`${{ images.managed_runner.image }}`。`check-release-boundary-contract` 会把
`release-contract.valid.json` 的顶层和 inventory runner image 与
`agentsmith-runner-image.lock` 对齐，防止 fixture/lock 漂移。该切片只是
AgentSmith release contract runner digest adoption：不是 release-kit
deployment readiness、不是 airgap/offline package readiness、不是
backend-real、真实 LLM、full runtime semantics，也不改
release-kit repo 或 runner repo。项目 pre-GA，不为旧
`${{ values.MANAGED_RUNNER_IMAGE }}`、旧字段或旧路径保留长期成功路径；旧输入
默认删除或 fail fast，只能作为负向测试或带 owner/删除条件/阶段的短期待删说明。
release-kit managed runner image closure consumption 已完成：
release-kit commit `b83d593 feat: consume managed runner image closure` 已推送到
`agentsmith-project/agentsmith-release-kit` main，remote CI run `26482179772`
success。release-kit 已消费 AgentSmith release contract 的 dynamic image closure；
`managed_runner` 是普通 digest-bound inventory image；`required_image_ids`、
`deploy_template_package.required_image_ids` 和 `deploy_image_inventory` ids
做 exact-set 对齐。P3 app-current six-image closure 只保留为历史完成切片；
当前规范口径是 dynamic release contract image closure，不把 6-image 升级成新的
7-image 长期心智。stale six-image、旧 `${{ values.MANAGED_RUNNER_IMAGE }}` 和旧
runner 名只作为 fail-fast 或 negative diagnostics。该切片不是 release readiness、
airgap ready、offline package readiness、registry mirror/login/push/pull、
deploy adoption/full online adoption/operator full verdict，也不是
backend-real、真实 LLM 或 full runtime semantics。
AgentSmith support API / projection contract consistency 当前切片已完成：
OpenAPI 已补齐 `/api/v1/context` GET、`/api/v1/context/list` GET 和
`/api/v1/context/managed-credentials/{provider}/refresh` POST 的 200 response
schema；`check-runner-support-api-projections` 对这三处 response schema 与
`@mbos/agent-runner-contract` 的 `CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA` 做严格
比较，`description` 不再被忽略；gate 递归拒绝 forbidden fields：
`context_store`、`writable_scopes`、`managed_credential_refresh`、
`credential_files`、`user_bearer_token`；focused 检查 `/api/v1/context` 和
`/api/v1/context/list` 的 `scope` query enum，retired `user` scope 只作为
negative/fail-fast，不是旧 scope 成功路径。本地 evidence：
`npm run test:run -- scripts/contracts/check-runner-support-api-projections.test.ts packages/agent-runner-contract/src/support-api-projections.test.ts packages/api-entry-node/src/context-route-handler.test.ts`
passed（42 tests passed）；`npm run contracts:check-runner-support-api-projections`
passed；`npm run contracts:check-openapi` passed；`npm run openapi:check-generated`
passed；`npm run contracts:check` passed；`git diff --check` passed。该切片不是
backend-real、真实 LLM、full runtime semantics、release readiness 或 airgap ready。
P5 request-scoped projected dependencies contract/env wiring focused slice 已完成：
AgentSmith commit `8c6df24c feat: add runner projected dependency contract` 已推送
main，`TaskExecutionContext` 新增 optional `projected_dependencies`，runtime
guard/schema/AsyncAPI/协议文档同步，`projected_dependencies.dependencies.*.fields`
继续对 `context_store`、`writable_scopes`、`managed_credential_refresh`、
`credential_files`、`user_bearer_token` fail fast；runner repo commit
`c67e837 feat: pass projected dependencies env` 已推送 main，`buildAgentRuntimeEnv`
始终输出 `MBOS_AGENT_PROJECTED_DEPENDENCIES`，存在时序列化
`executionContext.projected_dependencies`，缺省输出空字符串以阻断 parent env
leakage。runner repo 只消费 opaque request projection 的 bulk env，不新增
per-dependency env，不定义 Context Store、managed credential、scope 或 write policy
语义；这些投影语义仍由 AgentSmith/support API/contract 拥有。AgentSmith 本地
evidence：`npm run test:run -- packages/agent-runner-contract/src/protocol.test.ts packages/agent-runner-contract/src/contract-schema.test.ts packages/agent-runner-contract/src/support-api-projections.test.ts scripts/contracts/check-runner-support-api-projections.test.ts scripts/contracts/check-runner-contract-sync.test.ts`
passed（5 files / 70 tests）、`npm run contracts:check-runner-contract-sync`
passed、`npm run contracts:check-runner-support-api-projections` passed、
`npm run contracts:check-asyncapi-sync` passed、
`npm run contracts:check-agent-runner-contract-artifact` passed、
`npm run contracts:check` passed、`git diff --check` passed；remote evidence：
Contracts Check run `26522251350` success、Image Publish run `26522249787`
success、Quality Gates run `26522250713` success（`gate-fast`、`gate-default`、
`lane-visual` success，`lane-backend-real-core` skipped by workflow condition）。
runner repo 本地 evidence：`npm run check:source-boundary` passed、
`npm run typecheck` passed、`npm run test:fast -- src/agent-runtime-env.test.ts`
passed（3 tests）、`python3 builtin-skills/mbos-context/scripts/context_cli_test.py`
passed（3 tests）、临时安装 AgentSmith 更新后的 contract tgz 后
`bash scripts/test-runner-runtime-fast.sh` passed（17 TS test files / 155 tests +
builtin skill Python tests 3+2+4）、`npm run build` passed、
`bash scripts/verify-release.sh --start-guard` passed、one-off contract-to-env smoke
passed、`git diff --check` passed；runner remote CI run `26522674596` success
（`Quick governance`、`Runner skeleton start guard`、`Runner image smoke` success）。
release-kit side KISS check 确认无 docs/gates 需要同步、无 release-kit changes。
该切片不是 release readiness，不是 deployment/offline/airgap readiness，也不是
AgentSmith full adoption。
AgentSmith contract 收口：`agent.response.done.payload.usage_tokens` 已在
`docs/contracts/agent-execution-protocol.md` 与 AsyncAPI YAML/JSON 从必填修为
可选；缺省表示 runner 未上报真实 usage，runner 不得本地估算；这不是后端
行为新增，后端原本已按 optional 处理。
P2 online target-registry
confirmed apply/evidence spine 已在 release-kit sibling repo 完成：initial
spine commit `2d4739b` remote CI run `26439931859` success；strict live ref
no-op 修正 commit `5e08da3` 已提交推送，本地按 GitHub Actions 顺序全量通过
并额外通过 syntax/diff/secret scan，remote CI run `26440847230` success。它覆盖 base sequence
`inputs,target-preflight,template-package,image-map,render,render-check,apply,rollout,smoke`
在线 gate steps，render 使用 image-map target refs，rollout 对
`matched_by === 'digest'` 的 target/adopted refs 做 strict live ref check，
同 digest mixed source+target fail；target/adopted refs 如果 selected pods
只暴露 expected digest、没有可解析 digest-pinned live image ref，也 fail
fast；普通 source-registry rollout 仍保持 digest-only。online evidence root 是
`--evidence` revalidation 的
envelope/container，内含 `evidence.json`、`evidence-subject.json` 和
`online-deployment-gate-report.json`；machine accepted focused output 值是
`online-deployment-gate-report.json`，不是 evidence root 名称，也不是 release
readiness。
release-kit P2 operator-preloaded registry prerequisite binding 已完成：
sibling repo commit `49caf6f`。本地 release-kit focused gates 已通过
`bash scripts/test-operator-signoff-intake.sh`、
`bash scripts/test-evidence.sh`、`bash scripts/test-online-deployment-gate.sh`、
`bash scripts/test-registry-presence.sh`、`bash scripts/test-target-preflight.sh`、
`bash scripts/verify-release.sh --quick`、`node --check` touched mjs、
`bash -n` touched sh 和 `git diff --check`。远端 GitHub 已记录 PushEvent
到 `main`，但 GitHub Actions run 仍未创建；这里沿用当前 GitHub Actions
outage/pending，不写成 remote CI success。本切片把 operator-preloaded
registry prerequisite 绑定进 online gate：`--online-deployment-gate --mode
apply --target-registry` 必须带 `--registry-probe`；canonical producer
sequence 是 `image-map,registry-presence`，且 registry-presence 必须在
render/apply/rollout/smoke/evidence 前完成。source-registry apply 不受影响；
target-registry server-dry-run 不要求且不允许 `--registry-probe`。
`registry-presence` 只验证 image-map `target_image` 等于由 release contract
source image + `target_registry` 计算出的 deterministic mirror ref，且
operator 提供的只读 probe 对该 target digest 成功返回同一 digest；它不是
registry mirror/login/push/pull、不是 deploy adoption、不是 evidence
accepted output、不是 release readiness。`registry-presence-report.json` 仍被
`--evidence` 拒收。
release-kit operator signoff intake focused guard 已完成：sibling repo commit
`0854eeb`，GitHub Actions CI run `26444123230` success。新增
`--operator-signoff-intake` 只做 operator signoff intake JSON 与 confirmed
apply `online-deployment-gate-report.json` 的机器绑定校验，输出
`readiness=false`；它绑定 release id、git sha、release contract raw
sha256、target profile、operator_run_id 和 raw online gate report sha。online
gate report 必须是 apply 模式、canonical focused chain steps，并包含
`capability_map` 和 `generated_at`；target-registry report 含 image-map 时，
operator signoff intake 接受 canonical `image-map,registry-presence`
producer sequence。它不是 operator signature/identity/full verdict（正式签名验证、
身份系统、完整 verdict）、registry mirror/login/push/pull、full online
adoption、AgentSmith product-flow evidence、deploy/package/release readiness，
也不是 release-kit evidence envelope accepted output。
P3 `--airgap-bundle-render-check` focused diagnostic 已在 release-kit sibling
repo 完成（commit `3453c7d`，remote CI success）；它只证明 already assembled
airgap bundle 的 bundle-local offline render、render-check 和 target image
inventory，输出 `readiness=false`，且 `--evidence` 仍拒收
`airgap-bundle-render-check-report.json`。post-hardening review 已修复
forward-slash UNC-like path `//server/share/...` fail-fast 缺口。release-kit
P3 app-current image inventory closure 已完成（commit `b6e2fe7`，remote CI run
`26447029947` success）：valid fixtures 当时升级到 6 个 app-current image ids
`agentsmith_app`、`llmup`、`afscp`、`asbcp`、
`ingress_nginx_controller`、`ingress_nginx_certgen`；`required_image_ids` 在
inputs/template-package/airgap-bundle-check/image-map/render 关键入口做
exact-set closure，并校验 required ids 存在于 `deploy_image_inventory`；
pre-GA 旧 3-image 输入只保留为负向测试线索并 fail fast，不保留正式成功路径；
当前规范口径是 dynamic release contract image closure，不把 6-image 历史切片写成
长期固定清单。
P3 airgap image archive materiality focused diagnostic 已完成：release-kit
sibling repo commit `1d35fcc`（`1d35fcca7c9742a28dfb1220bd3ea777000ee7da`）已推送，
remote CI run `26449565986` success，head `1d35fcc`；本地同序完整 focused
gates 与 syntax/diff checks 通过。该 run 覆盖 quick、inputs、
template-package、render、render-check、image-map、registry-presence、
bundle-create、airgap-bundle-check、airgap-image-archive-check、
bundle-load-plan、airgap-bundle-render-check、apply、rollout、smoke、
online-deployment-gate、operator-signoff-intake、evidence、target-preflight。
这说明 `49caf6f` 后续同仓主线已被最新 successful run 覆盖，但不改写成
`49caf6f` 本身的历史 push run success。新增
`--airgap-image-archive-check` 只接受
`existing_kubernetes/external_declared/airgap`，先复用
`--airgap-bundle-check`，再用 operator-owned trusted local `--archive-probe`
检查每个 bundle image archive stdout digest 与 image-map `target_digest` /
release contract / bundle manifest 对齐；输出
`airgap-image-archive-check-report.json`、`readiness:false`、
`scope: airgap_image_archive_content_check_only`，且 `--evidence` 明确拒收。
probe 信任边界是 operator-owned/trusted local executable；release-kit 不
sandbox、不证明 probe 自身可信，只校验 stdout digest alignment。它不调用
docker/skopeo/oras/kubectl/curl/wget，不做 registry mirror/login/push/pull/
import，不做 image load/import/offline install/apply/smoke，不做 package/
deploy/release readiness，也不做 kind/cloud/provider matrix。
P3 airgap image load/import focused diagnostic 已完成：release-kit sibling repo
commit `11e3964 feat: add airgap image load diagnostic`
（`11e39646992cd27522f35b34af0bb3138e2c3f29`）已推送，remote CI run
`26514017089` success。本地 evidence：`bash scripts/test-airgap-image-load.sh`
passed（valid loader 以及 unsupported profile、noncanonical/alias profile、
missing archive materiality、loader nonzero、digest mismatch、extra stdout/stderr
负向用例），`bash scripts/test-evidence.sh` passed（明确拒收
`airgap-image-load-report.json`），`node --check
scripts/verify-airgap-image-load.mjs scripts/verify-evidence.mjs` passed，
`bash -n scripts/test-airgap-image-load.sh scripts/verify-release.sh` passed，
release-kit `git diff --check` passed。新增 `--airgap-image-load` 只接受
`existing_kubernetes/external_declared/airgap`，先复用
`--airgap-image-archive-check`，再调用 operator-provided `--image-loader`；
输出 `airgap-image-load-report.json`、`readiness:false`、
`scope: airgap_image_load_only`，且 `--evidence` 明确拒收。loader 信任边界是
operator-owned executable；release-kit 不选择 Docker/skopeo/oras/kubectl 或
registry credentials，只校验 loader stdout digest 与 `target_digest` 对齐。
它不声明 offline install/deploy/package/registry/release readiness，也不是
airgap ready。
release-kit P3 substrate pack focused gate 已完成：release-kit repo commit
`b264540 feat: add substrate pack focused gate`
（`b264540d3acad6bdb79c37d771538c5e67e5a6c0`）已推送 main；remote CI run
`26519104045` success，job `quick-governance` success，包含
`Substrate pack focused guard` success。本地 release-kit evidence passed：
`bash scripts/test-substrate-pack-check.sh`、
`bash scripts/test-target-preflight.sh`、`bash scripts/test-inputs.sh`、
`bash scripts/test-evidence.sh`、`bash scripts/verify-release.sh --quick`、
`node --check scripts/verify-substrate-pack-check.mjs scripts/lib/substrate-truth-validation.mjs`、
`bash -n scripts/test-substrate-pack-check.sh scripts/verify-release.sh`、
`git diff --check`，以及 AgentSmith
`npm run contracts:check-release-kit-source-boundary -- --scan-root /home/percy/works/mbos-v1/agentsmith-release-kit`。
新增 `--substrate-pack-check` focused diagnostic 只接受
`existing_kubernetes/kit_installed/online|airgap`，校验 minimal substrate pack
manifest + matching kit-installed substrate truth；输出
`substrate-pack-check-report.json`、`readiness:false`、
`scope: substrate_pack_check_only`，且 `--evidence` 明确拒收。它不是
substrate installer、不是 cloud provisioning、不是 DB/bucket/realm 创建，
也不是 registry/kubectl/deploy/rollout/smoke/package/release readiness。
release-kit `--substrate-routability` focused producer 已完成 local focused
evidence passed：`bash scripts/test-substrate-routability.sh`、
`bash scripts/test-evidence.sh`、`bash scripts/test-substrate-pack-check.sh`、
`bash scripts/test-target-preflight.sh` 和
`bash scripts/verify-release.sh --quick`。该 producer 只接受
`existing_kubernetes/kit_installed/online`，用于 Pod-network substrate endpoint
routability evidence；输出 `substrate-routability-report.json`、
`readiness:false`，且 `--evidence` 明确拒收。它不是 substrate installer、
不是 deploy/package/release readiness，也不给 release-kit operator verdict。
pre-GA 旧 profile/别名和 unsafe 输入只作为 fail-fast/负向测试：该命令拒绝
`external_declared`、`kind`、`local-kind`、`existing-cluster`、`real-k8s`、
`cluster`、`offline`、unsafe key/value 和 IPv6 loopback image ref；这些都不是
成功路径。
P5.1 runner start guard 已在 runner
sibling repo 完成（commit `cdfa800`，local consumer / start-guard /
full-gate-fail-closed checks passed，remote CI success）。P5.2 formal artifact
handoff 已在 AgentSmith commit `fcecb85b` 完成并验证：新增
`.github/workflows/runner-contract-artifact.yml` job
`runner-repo-contract-handoff`，依赖 `produce-runner-contract-artifact`，
下载同 run 的 `agentsmith-runner-contract-artifact`，checkout
`agentsmith-project/agentsmith-runner` 到 `agentsmith-runner`，并运行
`bash scripts/verify-release.sh --contract-consumer --artifact-root "$GITHUB_WORKSPACE/artifacts/runner-contract-download"`。
治理 guard 已收紧：handoff job 必须固定 5 个步骤、2 个 run step，不能混入
release readiness/runtime/image/adoption/signing/attestation/downloader。该 handoff
只证明 AgentSmith producer 产物能被 runner repo consumer 消费。P5.3a
runner release manifest skeleton/checker/start-guard 集成已在 runner repo 完成：
commit `7c43ba8 feat: add runner release manifest skeleton` 已推送到
`agentsmith-project/agentsmith-runner` main；remote CI run `26455289999`
成功，jobs `Quick governance` 和 `Runner start guard` 成功。本地 runner
证据：`bash scripts/test-runner-release-manifest.sh` passed；
`node --check scripts/check-runner-release-manifest.mjs` passed；
`bash scripts/verify-release.sh --quick` passed；
`bash scripts/verify-release.sh --start-guard` passed；
`bash -n scripts/verify-release.sh scripts/test-runner-release-manifest.sh scripts/check-governance-guard.sh scripts/test-runner-contract-consumer.sh`
passed；`git diff --check` passed；`bash scripts/verify-release.sh`
默认 fail-closed，退出码 2，明确 full release gate 未实现。P5.3a 只完成
release manifest skeleton/checker/start-guard 集成，不是 runtime migration、
image build/publish、AgentSmith adoption、lock update 或 release readiness。
复审修正后的设计要点：`image.id` 使用 `agentsmith-runner`，不保留
`agent-task-runner` 旧别名；`contract_artifact` 绑定 P5.2 正式事实字段
`package_uri`、`package_sha256`、`package_integrity`、
`descriptor_subject_sha256`，不发明 `descriptor_uri` / `descriptor_sha256`；
workflow/job/generator 只要求非空，不硬编码未来 release producer；P5.3a
skeleton 阶段 `artifact_provenance.artifact_sha256 == subject_sha256` 只是
runner manifest subject binding / skeleton-compatible field，不是可下载
artifact 内容 hash 或远端 artifact digest 证明；CLI/docs 使用 `<manifest-path>`。team review 结论：
之前两个 block（旧 image id、contract_artifact 不对齐 P5.2 handoff /
artifact_sha256 未绑定）已修正；最终复核无语义阻断，只提醒新增脚本必须
纳入 commit，已纳入。这些完成项不是
runtime migration、registry mirror/login/push/pull、deploy adoption、cloud
provisioning、image load/import、offline install/apply/smoke、full online
adoption、release-kit operator signature/identity/full verdict（正式签名验证/身份/完整 verdict）、
AgentSmith product-flow evidence 收口、deployment/package/operator full
adoption、airgap ready 或 release readiness。
P5.3b first half 已在 runner repo 完成并推进到 boundary closure：
`a6ddb50 fix: keep runner skills projection-only` 保留为 projection-only
builtin skills 修复事实；追加 commit
`fd6d851 fix: keep runner workspace contract-only` 已让 runner runtime 移除
workspace-access/file-library product API、AFSCP binding schema 和 release
fence payload，`prepareTaskWorkspace` 只消费 `@mbos/agent-runner-contract`
execution context/path fields，release no-op，`agent.response.done` 不再伪造
`usage_tokens`；`4dbbd26 fix: keep runner artifact scan policy-local` 已让
artifact scan 移除 `.trash` / `.minio.sys` file-library reserved namespace
policy，只保留 runner runtime/local tool roots filtering；当前 P5.3b boundary
closure runner HEAD 是
`7d21959 test: harden runner product boundary guard`，guard/self-test 已覆盖
`.trash`、`.minio.sys`、file-library reserved namespace、`usage_tokens` 多种
键/赋值形态、workspace-access/release fence 等 forbidden patterns。remote
CI：`a6ddb50` run `26463276084` 成功；`fd6d851` run `26465341186` 成功；
`4dbbd26` run `26465733200` 成功；`7d21959` run `26465985945` 成功。
完成范围是 runner repo 拥有 repo-local runtime source、builtin skills、root
package/tsconfig/vitest、source-boundary/product semantics guard、runtime fast
focused diagnostic 和 clean-dependency start-guard guard；builtin skill runtime
已从本地定义 Context Store scopes / writable scopes / managed credential
resolution/refresh endpoint，收敛为只消费 AgentSmith 已提供的 opaque request
projections + explicit CLI 参数。`scripts/check-runner-source-boundary.mjs`
已新增 product semantics guard，禁止 runner repo 定义 `project_member` /
`writable_scopes` / `context_store` capability/managed credential schemas、
`/context` endpoints、managed credential refresh/key semantics；local
dependency protocols 也增加 `portal:`。本地 runtime fast evidence：
`bash scripts/test-runner-runtime-fast.sh` passed，Vitest 16 files / 152 tests
passed，builtin skill Python tests 3+2+4 passed；`bash scripts/verify-release.sh --quick`
passed；`bash scripts/verify-release.sh --start-guard` passed；`npm run build` passed；
clean no-node_modules start-guard passed；clean no-node_modules runtime fast
按预期 fail fast，rc=2，并输出明确 dependency/artifact message。`--start-guard`
在 clean CI 不跑 runtime fast；runtime fast 需要显式 contract artifact package
和 dev deps。`@mbos/agent-runner-contract` 当前未发布到 npm，不能把普通
`npm install` 写成证据。该切片不是 image build/publish、Dockerfile migration、
AgentSmith adoption lock、release contract digest adoption、release readiness，
也不证明当时的 AgentSmith 侧 support API / projection contract 一致性已收口；
该一致性已由后续 AgentSmith support API gate 切片完成。
P3-P6 仍受本计划里的 phase checks、evidence mapping、provenance checks、
redaction checks 和 image inventory truth 约束。
最新 review 结论已收口：当前
`existing-cluster` 仍降级为 Docker substrate/IP-only diagnostic；正式 runner
contract artifact 是外部 `runner-contract-artifact.json` + tgz，包内 manifest
是 package manifest v1。本切片已补齐 release contract 的
`deploy_image_inventory` 与 `deploy_template_package.required_image_ids` 双向
一致性 fail-fast guard，避免 orphan image truth；不新增第二套 top-level
required image IDs 字段。AgentSmith release boundary inventory alignment 已完成
（commit `86fbc7a0`，local tests/contracts passed，remote CI success）；
pre-GA 旧输入/旧路径/旧命名不保留长期正式路径文档澄清已完成（commit
`66bf231e docs: clarify pre-GA old-input fail-fast rule`，remote Contracts Check run
`26469713784` success）。DeepSeek/LLM real lane 没有 tracked changes；AgentSmith defaults
和 ignored local env 使用 DeepSeek endpoint/model，LLMUP real
smoke 15 passed / 0 failed / 1 skipped，未提交 secret。AgentSmith commit
`fcecb85b` 已推送；P5.2 historical Runner Contract Artifact workflow_dispatch
在 `fcecb85b` 成功，`produce-runner-contract-artifact`、
`runner-repo-contract-handoff` 和 `consume-runner-contract-artifact` 全部成功；
新增 `runner-repo-contract-handoff` job 用时 12s。Push Contracts Check run
`26451741559` 在 `fcecb85b` 成功。Push Image Publish run `26451741631` 在
`fcecb85b` 成功，但只是 push side effect，不作为 P5.2 readiness。runner
repo commit `7c43ba8 feat: add runner release manifest skeleton` 已推送到
`agentsmith-project/agentsmith-runner` main；remote CI run `26455289999`
成功，jobs `Quick governance` 和 `Runner start guard` 成功。P5.3a 只完成
runner release manifest skeleton/checker/start-guard 集成，不是 runtime
migration、image build/publish、AgentSmith adoption、lock update 或 release
readiness。runner P5.3b boundary closure 最新 runner HEAD 是
`7d21959 test: harden runner product boundary guard`；`a6ddb50` 保留为
projection-only builtin skills 修复事实，后续 `fd6d851` 已保持 runner
workspace contract-only，`4dbbd26` 已保持 artifact scan policy-local。remote
CI：`a6ddb50` run `26463276084` 成功，`fd6d851` run `26465341186` 成功，
`4dbbd26` run `26465733200` 成功，`7d21959` run `26465985945` 成功。
P5.3b first half 完成 repo-local runtime source、builtin skills、root
package/tsconfig/vitest、source-boundary/product semantics guard、runtime fast
focused diagnostic 和 clean-dependency start-guard guard，并把 builtin skill
runtime 收敛为只消费 AgentSmith opaque request projections + explicit CLI 参数；
追加 boundary 修复还确保 runner runtime 不消费 workspace-access/file-library
product API、AFSCP binding schema 或 release fence payload，artifact scan 不承载
file-library reserved namespace policy，且 `agent.response.done` 不再伪造
`usage_tokens`。它不包含 image build/publish、Dockerfile migration、
AgentSmith adoption lock、release contract digest adoption、release readiness
或当时的 AgentSmith 侧 support API / projection contract 一致性收口；该一致性
已由后续 AgentSmith support API gate 切片完成。AgentSmith contract
收口已把 `agent.response.done.payload.usage_tokens` 从必填修为可选；缺省表示
runner 未上报真实 usage，runner 不得本地估算，且这不是后端行为新增。此前 AgentSmith commit `7cf783c2` 已推送；远端 Contracts Check run `26447963233`
因 GitHub Actions checkout/auth 403 失败，不是治理脚本失败。下一步不再是 P2
target-preflight、P2 online apply/evidence spine、P2 operator-preloaded
registry prerequisite binding、P3 render-check focused diagnostic、P3 airgap
image archive materiality focused diagnostic、P3 airgap image load/import focused
diagnostic、P5.1 启动或 P5.2 formal artifact
handoff，kit_installed/online focused composition 已完成；下一步仍是 P2 full
online adoption 与 AgentSmith product-flow evidence 分别收口；也不是
P5.3a/P5.3b first half 后直接跳到 release readiness。release-kit operator
signature/identity/full verdict（正式签名验证/身份/完整 verdict）deferred，只有出现明确客户/合规/发布消费方需要时再做，
真实 deploy/smoke 站稳前不推进；P3 airgap image load/import focused diagnostic
和 airgap focused deployment gate 已完成，剩余是 full offline install/package/adoption readiness 收口；P5 runner publish manifest
focused evidence 之后的 AgentSmith manifest/lock adoption 与 release contract
runner digest adoption 已完成，release-kit managed runner image closure consumption
也已完成；后续是 runtime semantics 专项，以及 P2/P3 deployment/operator/adoption
收口；仍不是 release readiness。

</details>

## Section 3.1 Evidence Ledger

### 3.1 Evidence log / 下一步边界

本节只保留交接用 evidence log 和下一步边界判断。它不定义新的正式发布目标，
不把历史 profile、旧路径或 focused diagnostic 升级为 release contract 输入，
也不替代 release-kit repo-local deployment/package/operator verdict。

从本次补丁起，主计划里的长 evidence log 冻结：后续不再滚动追加长段历史证据。
新证据只保留当前状态、下一步、阻断项和 artifact/CI 引用；历史正文本次不删除，
只按只读交接证据保留。

本切片已收口 release contract image inventory 与 deploy template package
required image IDs 的双向一致性 guard；P2 online target-registry confirmed
apply/evidence spine、P2 registry presence focused diagnostic、P3
`--airgap-bundle-render-check` focused diagnostic、P3 app-current image
inventory closure、P3 `--airgap-image-archive-check` materiality focused
diagnostic、P3 `--airgap-image-load` focused diagnostic、P3
`--airgap-deployment-gate` focused gate、P3
`--substrate-pack-check` focused diagnostic、P3 `--substrate-routability`
focused producer、P2 kit_installed/online focused composition、release-kit operator signoff intake focused guard、P5.1 runner
start guard 和 P5.2 formal artifact handoff 已完成；P2 operator-preloaded registry prerequisite binding
也已完成；P5.3a runner release manifest skeleton/checker/start-guard 集成已完成；
P5.3b first half 已完成 runner repo-local runtime source、builtin skills、
runtime fast focused diagnostic 和 clean-dependency start-guard guard；P5 focused
image build/start smoke 已完成；P5 runner publish manifest focused evidence 已完成；
AgentSmith manifest/lock adoption、release contract runner digest adoption、
release_kit_managed_runner_image_closure_consumption_done 和 AgentSmith support API /
projection contract consistency 当前切片已完成；P5 request-scoped projected
dependencies contract/env wiring focused slice 和 P5 runner focused image
task-execution smoke、AgentSmith `--runner-projection-smoke` canonical lock truth 也已完成。release-kit 已消费
AgentSmith release contract 的 dynamic image closure，`managed_runner` 是普通
digest-bound inventory image，并与 `required_image_ids`、
`deploy_template_package.required_image_ids`、`deploy_image_inventory` ids 做
exact-set 对齐；P3 app-current six-image closure 只保留为历史完成切片，不升级为新的
7-image 长期心智。
仍不宣称 release-kit/operator registry mirror/login/push/pull、
deploy adoption、full online adoption、release-kit operator
signature/identity/full verdict（正式签名验证/身份/完整 verdict）、AgentSmith product-flow evidence
收口、deployment/package/operator full adoption、airgap full offline
install/package/adoption readiness、substrate installer、Pod-network routability 之外的
substrate 安装/部署结论、cloud provisioning、DB/bucket/realm 创建、backend-real、
真实 LLM、full runtime semantics、AgentSmith full adoption、airgap ready 或 release readiness。

近期完成证据：

1. AgentSmith release boundary inventory alignment 已完成：commit `86fbc7a0`，local tests/contracts passed，remote CI success。
2. AgentSmith pre-GA 旧输入/旧路径/旧命名不保留长期正式路径文档澄清已完成：commit `66bf231e docs: clarify pre-GA old-input fail-fast rule`，remote Contracts Check run `26469713784` success。
3. release-kit P2 online target-registry confirmed apply/evidence spine 已完成：initial spine commit `2d4739b`，remote `agentsmith-project/agentsmith-release-kit` CI run `26439931859` success；strict live ref no-op 修正 commit `5e08da3` 已提交推送，remote CI run `26440847230` success；本地按 GitHub Actions 顺序通过 `verify-release --quick`、`test-inputs`、`test-template-package`、`test-render`、`test-render-check`、`test-image-map`、`test-bundle-create`、`test-airgap-bundle-check`、`test-bundle-load-plan`、`test-airgap-bundle-render-check`、`test-apply`、`test-rollout`、`test-smoke`、`test-online-deployment-gate`、`test-evidence`、`test-target-preflight`；额外 `node --check scripts/verify-rollout.mjs`、`node --check scripts/verify-online-deployment-gate.mjs`、`bash -n scripts/test-online-deployment-gate.sh scripts/test-rollout.sh scripts/verify-release.sh`、`git diff --check` 和 secret scan passed，新增 diff 无真实 secret。
4. release-kit operator signoff intake focused guard 已完成：sibling repo commit `0854eeb`，GitHub Actions CI run `26444123230` success；`--operator-signoff-intake` 只做 operator signoff intake JSON 与 confirmed apply `online-deployment-gate-report.json` 的机器绑定校验，输出 `readiness=false`，绑定 release id、git sha、release contract raw sha256、target profile、operator_run_id 和 raw online gate report sha；online gate report 必须是 apply 模式、canonical focused chain steps，并包含 `capability_map` 和 `generated_at`；target-registry report 含 image-map 时，operator signoff intake 接受 canonical `image-map,registry-presence` producer sequence；这不是 operator signature/identity/full verdict（正式签名验证、身份系统、完整 verdict）、registry mirror/login/push/pull、full online adoption、AgentSmith product-flow evidence、deploy/package/release readiness，也不是 release-kit evidence envelope accepted output。
5. release-kit P3 `--airgap-bundle-render-check` focused diagnostic 已完成：sibling repo commit `3453c7d`，remote CI success；只证明 already assembled airgap bundle 的 bundle-local offline render、render-check 和 target image inventory，`readiness=false`，`--evidence` 仍拒收 `airgap-bundle-render-check-report.json`。
6. release-kit P3 app-current image inventory closure 已完成：sibling repo commit `b6e2fe7`，remote CI run `26447029947` success；valid fixtures 当时升级到 6 个 app-current image ids：`agentsmith_app`、`llmup`、`afscp`、`asbcp`、`ingress_nginx_controller`、`ingress_nginx_certgen`；`required_image_ids` 在 inputs/template-package/airgap-bundle-check/image-map/render 关键入口做 exact-set closure，并校验 required ids 存在于 `deploy_image_inventory`；bundle create/load-plan/render-check 相关测试不再隐含 pre-GA 旧 3-image 输入；render/apply/rollout 旁路测试修掉 unknown digest 碰撞。当前规范口径已转为 dynamic release contract image closure，不把 6-image 历史切片写成固定长期清单。
7. release-kit P2 operator-preloaded registry prerequisite binding 已完成：sibling repo commit `49caf6f`；本地通过 `bash scripts/test-operator-signoff-intake.sh`、`bash scripts/test-evidence.sh`、`bash scripts/test-online-deployment-gate.sh`、`bash scripts/test-registry-presence.sh`、`bash scripts/test-target-preflight.sh`、`bash scripts/verify-release.sh --quick`、`node --check` touched mjs、`bash -n` touched sh 和 `git diff --check`。`--online-deployment-gate --mode apply --target-registry` 必须带 `--registry-probe`；canonical producer sequence 是 `image-map,registry-presence`，且 registry-presence 必须在 render/apply/rollout/smoke/evidence 前完成。source-registry apply 不受影响；target-registry server-dry-run 不要求且不允许 `--registry-probe`。registry presence 只验证 `image-map` 的 `target_image` 等于由 release contract source image + `target_registry` 计算出的 deterministic mirror ref，并验证 operator 只读 probe 返回同一 target digest；不是 registry mirror/login/push/pull、不是 deploy adoption、不是 release readiness，`registry-presence-report.json` 仍被 `--evidence` 拒收。远端 GitHub 已记录 PushEvent 到 `main`，但 GitHub Actions run 仍未创建；这里沿用当前 GitHub Actions outage/pending，不写成 remote CI success。
8. release-kit P3 airgap image archive materiality focused diagnostic 已完成：sibling repo commit `1d35fcc`（`1d35fcca7c9742a28dfb1220bd3ea777000ee7da`）已推送，remote CI run `26449565986` success，head `1d35fcc`；本地同序完整 focused gates 与 syntax/diff checks 通过。远端 run 覆盖 quick、inputs、template-package、render、render-check、image-map、registry-presence、bundle-create、airgap-bundle-check、airgap-image-archive-check、bundle-load-plan、airgap-bundle-render-check、apply、rollout、smoke、online-deployment-gate、operator-signoff-intake、evidence、target-preflight。这说明 `49caf6f` 后续同仓主线已被最新 successful run 覆盖，但不改写成 `49caf6f` 本身的历史 push run success。`--airgap-image-archive-check` 只接受 `existing_kubernetes/external_declared/airgap`，先复用 `--airgap-bundle-check`，再用 operator-owned trusted local `--archive-probe` 检查每个 bundle image archive stdout digest 与 image-map `target_digest` / release contract / bundle manifest 对齐；输出 `airgap-image-archive-check-report.json`、`readiness:false`、`scope: airgap_image_archive_content_check_only`，`--evidence` 明确拒收。probe 信任边界是 operator-owned/trusted local executable；release-kit 不 sandbox、不证明 probe 自身可信，只校验 stdout digest alignment。它不调用 docker/skopeo/oras/kubectl/curl/wget，不做 registry mirror/login/push/pull/import，不做 image load/import/offline install/apply/smoke，不做 package/deploy/release readiness，也不做 kind/cloud/provider matrix。
9. release-kit P3 airgap image load/import focused diagnostic 已完成：sibling repo commit `11e3964 feat: add airgap image load diagnostic`（`11e39646992cd27522f35b34af0bb3138e2c3f29`）已推送，remote CI run `26514017089` success；本地通过 `bash scripts/test-airgap-image-load.sh`、`bash scripts/test-evidence.sh`、`node --check scripts/verify-airgap-image-load.mjs scripts/verify-evidence.mjs`、`bash -n scripts/test-airgap-image-load.sh scripts/verify-release.sh` 和 `git diff --check`。`--airgap-image-load` 只接受 `existing_kubernetes/external_declared/airgap`，先复用 `--airgap-image-archive-check`，再调用 operator-provided `--image-loader`；输出 `airgap-image-load-report.json`、`readiness:false`、`scope: airgap_image_load_only`，`--evidence` 明确拒收。loader 信任边界是 operator-owned executable；release-kit 不选择 Docker/skopeo/oras/kubectl 或 registry credentials，只校验 loader stdout digest 与 `target_digest` 对齐。它不是 offline install/deploy/package/registry/release readiness，也不是 airgap ready。
10. release-kit P3 substrate pack focused gate 已完成：release-kit repo commit `b264540 feat: add substrate pack focused gate`（`b264540d3acad6bdb79c37d771538c5e67e5a6c0`）已推送 main；remote CI run `26519104045` success，job `quick-governance` success，包含 `Substrate pack focused guard` success。本地 release-kit evidence passed：`bash scripts/test-substrate-pack-check.sh`、`bash scripts/test-target-preflight.sh`、`bash scripts/test-inputs.sh`、`bash scripts/test-evidence.sh`、`bash scripts/verify-release.sh --quick`、`node --check scripts/verify-substrate-pack-check.mjs scripts/lib/substrate-truth-validation.mjs`、`bash -n scripts/test-substrate-pack-check.sh scripts/verify-release.sh`、`git diff --check`，以及 AgentSmith `npm run contracts:check-release-kit-source-boundary -- --scan-root /home/percy/works/mbos-v1/agentsmith-release-kit` passed。`--substrate-pack-check` 只接受 `existing_kubernetes/kit_installed/online|airgap`，校验 minimal substrate pack manifest + matching kit-installed substrate truth；输出 `substrate-pack-check-report.json`、`readiness:false`、`scope: substrate_pack_check_only`，`--evidence` 明确拒收。它不是 substrate installer、不是 cloud provisioning、不是 DB/bucket/realm 创建，也不是 registry/kubectl/deploy/rollout/smoke/package/release readiness。pre-GA 旧 profile/别名（`external_declared` 对该命令、`kind`、`local-kind`、`existing-cluster`、`real-k8s`、`cluster`、`offline`）、unsafe key/value、IPv6 loopback image ref 都 fail fast/负向测试，不作为成功路径。
    release-kit P3 `--substrate-routability` focused producer 已完成 local focused evidence passed：`bash scripts/test-substrate-routability.sh`、`bash scripts/test-evidence.sh`、`bash scripts/test-substrate-pack-check.sh`、`bash scripts/test-target-preflight.sh` 和 `bash scripts/verify-release.sh --quick`。该 producer 只接受 `existing_kubernetes/kit_installed/online`，用于 Pod-network substrate endpoint routability evidence；输出 `substrate-routability-report.json`、`readiness:false`，`--evidence` 明确拒收。它不是 substrate installer、不是 deploy/package/release readiness，也不是 release-kit operator verdict；release-kit repo commit `e4e2e1b feat: add substrate routability diagnostic` 已推送 `agentsmith-project/agentsmith-release-kit` main，remote CI run `26644787964` success，job `quick-boundary` success，包含 `Substrate routability focused guard` success，URL：`https://github.com/agentsmith-project/agentsmith-release-kit/actions/runs/26644787964`。
    release-kit P2 kit_installed/online focused composition 已完成：release-kit commit `486750f feat: compose kit-installed online deployment gate`（`486750fddb54e943fd3db623eb3350f2d3ac337b`）已推送，remote CI run `26651499140` success，URL：`https://github.com/agentsmith-project/agentsmith-release-kit/actions/runs/26651499140`；job `quick-boundary` success，覆盖 `Online deployment gate focused guard`、`Substrate pack focused guard`、`Substrate routability focused guard`、`Kubernetes apply-only focused guard`、`Kubernetes rollout/live imageID focused guard`、`Route smoke focused guard`、`Evidence envelope focused guard`、`Target preflight focused guard` success。本地主控 release-kit focused evidence passed：`bash scripts/test-online-deployment-gate.sh`、`bash scripts/test-evidence.sh`、`bash scripts/test-operator-signoff-intake.sh`、`bash scripts/test-inputs.sh`、`bash scripts/test-substrate-pack-check.sh`、`bash scripts/test-substrate-routability.sh`、`bash scripts/test-apply.sh`、`bash scripts/test-rollout.sh`、`bash scripts/test-smoke.sh`、`bash scripts/verify-release.sh --quick`、`node --check scripts/verify-online-deployment-gate.mjs scripts/verify-apply.mjs scripts/verify-rollout.mjs scripts/verify-smoke.mjs scripts/lib/release-kit-version-policy.mjs`、`bash -n scripts/verify-release.sh scripts/test-inputs.sh scripts/test-apply.sh scripts/test-rollout.sh scripts/test-smoke.sh scripts/test-online-deployment-gate.sh`、`git diff --check`；AgentSmith source-boundary scan `npm run contracts:check-release-kit-source-boundary -- --scan-root /home/percy/works/mbos-v1/agentsmith-release-kit` passed。`--online-deployment-gate` 现在支持 `existing_kubernetes/kit_installed/online` source-registry focused chain；kit path 串联 `inputs,target-preflight,substrate-pack-check,template-package,substrate-routability,render,render-check,apply`，apply 模式再有 `rollout` 和可选 `smoke`。kit path 需要 `--substrate-pack-manifest` 和 `--routability-probe`，拒绝 `--target-registry`、`--registry-probe`、`--evidence-root`；external path 拒绝 kit-only substrate args。`online-deployment-gate-report.json` 仍是 `readiness:false` / `scope: online_deployment_gate_only`；kit capability map 标 `evidence_envelope: unsupported`，standalone substrate reports 仍被 `--evidence` 拒收。它不是 substrate installer、cloud provisioning、registry mirror/login/push/pull、release readiness、deploy/package/operator verdict、operator signature/identity/full verdict（正式签名验证、身份系统、完整 verdict）或 AgentSmith product-flow evidence。
11. post-hardening review 已修复 forward-slash UNC-like path `//server/share/...` fail-fast 缺口。
12. runner P5.1 start guard 已完成：sibling repo commit `cdfa800`，local consumer / start-guard / full-gate-fail-closed checks passed，remote CI success。
13. AgentSmith P5.2 formal artifact handoff 已完成：AgentSmith commit `fcecb85b feat: add runner repo contract handoff` 新增 `.github/workflows/runner-contract-artifact.yml` job `runner-repo-contract-handoff`。该 job 依赖 `produce-runner-contract-artifact`，下载同 run 的 `agentsmith-runner-contract-artifact`，checkout `agentsmith-project/agentsmith-runner` 到 `agentsmith-runner`，并运行 `bash scripts/verify-release.sh --contract-consumer --artifact-root "$GITHUB_WORKSPACE/artifacts/runner-contract-download"`；它只证明 AgentSmith producer 产物能被 runner repo consumer 消费。治理 guard 已收紧：handoff job 必须固定 5 个步骤、2 个 run step，不能混入 release readiness/runtime/image/adoption/signing/attestation/downloader。本地 evidence：`npm run contracts:check-current-workflows` passed；`npm run test:run -- scripts/governance/__tests__/current-workflow-governance.test.ts scripts/governance/__tests__/runner-contract-artifact.test.ts scripts/contracts/check-agent-runner-contract-artifact.test.ts scripts/governance/__tests__/verify-impact-selector.test.ts` passed, 169 tests；`npm run contracts:check-agent-runner-contract-artifact` passed；`bash /home/percy/works/mbos-v1/agentsmith-runner/scripts/verify-release.sh --start-guard` passed；local generated artifact handoff smoke passed（AgentSmith generated artifact root -> AgentSmith artifact checker -> runner repo `--contract-consumer`）；`git diff --check` passed。Remote evidence：P5.2 historical Runner Contract Artifact workflow_dispatch succeeded on `fcecb85b`，jobs `produce-runner-contract-artifact`、`runner-repo-contract-handoff` 和 `consume-runner-contract-artifact` all succeeded，新增 `runner-repo-contract-handoff` job succeeded in 12s；Push Contracts Check run `26451741559` succeeded on `fcecb85b`；Push Image Publish run `26451741631` succeeded on `fcecb85b`，但这是 push side effect，不作为 P5.2 readiness。
14. runner P5.3a release manifest skeleton/checker/start-guard 集成已完成：runner repo commit `7c43ba8 feat: add runner release manifest skeleton` 已推送到 `agentsmith-project/agentsmith-runner` main；remote CI run `26455289999` 成功，jobs `Quick governance` 和 `Runner start guard` 成功。本地 runner evidence：`bash scripts/test-runner-release-manifest.sh` passed；`node --check scripts/check-runner-release-manifest.mjs` passed；`bash scripts/verify-release.sh --quick` passed；`bash scripts/verify-release.sh --start-guard` passed；`bash -n scripts/verify-release.sh scripts/test-runner-release-manifest.sh scripts/check-governance-guard.sh scripts/test-runner-contract-consumer.sh` passed；`git diff --check` passed；`bash scripts/verify-release.sh` 默认 fail-closed，退出码 2，明确 full release gate 未实现。P5.3a 只完成 release manifest skeleton/checker/start-guard 集成，不是 runtime migration、image build/publish、AgentSmith adoption、lock update 或 release readiness。复审修正后的设计要点：`image.id` 使用 `agentsmith-runner`，不保留 `agent-task-runner` 旧别名；`contract_artifact` 绑定 P5.2 正式事实字段 `package_uri`、`package_sha256`、`package_integrity`、`descriptor_subject_sha256`，不发明 `descriptor_uri` / `descriptor_sha256`；workflow/job/generator 只要求非空，不硬编码未来 release producer；P5.3a skeleton 阶段 `artifact_provenance.artifact_sha256 == subject_sha256` 只是 runner manifest subject binding / skeleton-compatible field，不是可下载 artifact 内容 hash 或远端 artifact digest 证明；CLI/docs 使用 `<manifest-path>`。team review 结论：之前两个 block（旧 image id、contract_artifact 不对齐 P5.2 handoff / artifact_sha256 未绑定）已修正；最终复核无语义阻断，只提醒新增脚本必须纳入 commit，已纳入。
15. AgentSmith P5.3a machine contract alignment 已完成：AgentSmith release boundary schema、positive runner manifest fixture、runner image lock fixture 和 adoption checker 默认路径已对齐 runner repo P5.3a skeleton。`runner-release-manifest.valid.json` 现在要求 canonical `image.id=agentsmith-runner`、digest-pinned GHCR image ref、P5.2 `contract_artifact` 字段、fail-fast `adoption_policy` 和 skeleton `artifact_sha256 == subject_sha256`；positive lock fixture 已从旧 `agent-task-runner-image.lock` 收敛到 `agentsmith-runner-image.lock`，旧 identity 只做负向测试，不保留正式路径支持。本地 evidence：`npm run test:run -- scripts/governance/__tests__/current-release-boundary-schema.test.ts scripts/contracts/check-runner-image-lock.test.ts scripts/contracts/check-release-boundary-contract.test.ts` passed；`npm run contracts:check-runner-image-lock -- --adoption --manifest scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json` passed；runner repo checker `node /home/percy/works/mbos-v1/agentsmith-runner/scripts/check-runner-release-manifest.mjs --manifest scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json` passed。该切片不是 runtime migration、image build/publish、真实 adoption 或 release readiness。
16. runner P5.3b first half runtime fast focused diagnostic 已完成并推进到 boundary closure：`a6ddb50 fix: keep runner skills projection-only` 保留为 projection-only builtin skills 修复事实；`fd6d851 fix: keep runner workspace contract-only` 已移除 runner runtime 对 workspace-access/file-library product API、AFSCP binding schema 和 release fence payload 的依赖，`prepareTaskWorkspace` 只消费 `@mbos/agent-runner-contract` execution context/path fields，release no-op，`agent.response.done` 不再伪造 `usage_tokens`；`4dbbd26 fix: keep runner artifact scan policy-local` 已把 artifact scan 收敛为 runner runtime/local tool roots filtering，不承载 `.trash` / `.minio.sys` file-library reserved namespace policy；当前 P5.3b boundary closure runner HEAD 是 `7d21959 test: harden runner product boundary guard`，guard/self-test 已覆盖 `.trash`、`.minio.sys`、file-library reserved namespace、`usage_tokens` 多种键/赋值形态、workspace-access/release fence 等 forbidden patterns。
    remote CI：`a6ddb50` run `26463276084` 成功；`fd6d851` run `26465341186` 成功；`4dbbd26` run `26465733200` 成功；`7d21959` run `26465985945` 成功。完成范围是 runner repo 拥有 repo-local runtime source、builtin skills、root package/tsconfig/vitest、source-boundary/product semantics guard、runtime fast focused diagnostic 和 clean-dependency start-guard guard；builtin skill runtime 已从本地定义 Context Store scopes / writable scopes / managed credential resolution/refresh endpoint，收敛为只消费 AgentSmith 已提供的 opaque request projections + explicit CLI 参数。`scripts/check-runner-source-boundary.mjs` 已新增 product semantics guard，禁止 runner repo 定义 `project_member` / `writable_scopes` / `context_store` capability/managed credential schemas、`/context` endpoints、managed credential refresh/key semantics；local dependency protocols 也增加 `portal:`。本地 evidence：`bash scripts/test-runner-runtime-fast.sh` passed，Vitest 16 files / 152 tests passed，builtin skill Python tests 3+2+4 passed；`bash scripts/verify-release.sh --quick` passed；`bash scripts/verify-release.sh --start-guard` passed；`npm run build` passed；clean no-node_modules start-guard passed；clean no-node_modules runtime fast 按预期 fail fast，rc=2，并输出明确 dependency/artifact message。`--start-guard` 在 clean CI 不跑 runtime fast；runtime fast 需要显式 contract artifact package 和 dev deps。`@mbos/agent-runner-contract` 当前未发布到 npm，不能把普通 `npm install` 写成证据。该切片不是 image build/publish、Dockerfile migration、AgentSmith adoption lock、release contract digest adoption、release readiness，也不证明当时的 AgentSmith 侧 support API / projection contract 一致性已收口；该一致性已由后续 AgentSmith gate 切片完成。项目 pre-GA 不为旧输入、旧路径、旧命名保留长期心智负担；这次修复就是为了不把 AgentSmith 产品语义搬成 runner repo 长期职责或正式路径，旧 runner 路径/包名只作为负向测试或短期待删说明，不作为正式成功路径。
17. runner P5 focused image build/start smoke 已完成：runner repo commit `b80ea3c feat: add runner image smoke gate`；runner remote CI run `26468415599` success，jobs `Runner image smoke`、`Runner skeleton start guard`、`Quick governance` success。本地主控 evidence：`bash scripts/verify-release.sh --quick` passed；`bash scripts/verify-release.sh --start-guard` passed；通过 explicit artifact root `/tmp/agentsmith-runner-contract-artifact.xxwfV1` 运行 `--contract-consumer` passed；`bash scripts/verify-release.sh --image-smoke --artifact-root /tmp/agentsmith-runner-contract-artifact.xxwfV1` passed，Docker build 成功，missing env run exit 1 且 stderr 包含 `Usage`，输出 `image smoke passed`；`git diff --check` passed。只读 review 无阻断；两个 low consistency gap 已修复（ADR bootstrap 历史口径、PR template image smoke checklist）。该切片不是 GHCR publish、不登录 registry、不生成 release manifest、不产生 release manifest image digest、不更新 AgentSmith adoption lock、不改 release contract runner digest、不是 release readiness、不迁入 AgentSmith product semantics。
18. runner P5 publish manifest focused evidence 已完成：current runner HEAD 为 `8b2541d9e2b11b3b97481443b061cb7fbc952080`（short `8b2541d`）。Final publish run `26582224675`（workflow_dispatch，headSha `8b2541d9e2b11b3b97481443b061cb7fbc952080`）成功，使用 AgentSmith contract artifact package `gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/26580019002/mbos-agent-runner-contract-0.1.0.tgz`，job `Publish digest-pinned runner image evidence` 完成 download AgentSmith artifact、contract consumer、no-push image smoke、GHCR login、build/push image、resolve digest、write manifest、verify manifest 和 upload `runner-release-manifest`。artifact id `7269115958`，size 1074 bytes；published image ref 为 `ghcr.io/agentsmith-project/agentsmith-runner:release-p5-publish-8b2541d@sha256:26ba63e1e8c92ac9f8499c55bf4aeaf15c463f0e0682eee523268ee84b44fde7`；manifest `artifact_provenance.artifact_uri` 为 `gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/26582224675/runner-release-manifest.json`，`subject_sha256` 为 `sha256:443ca4e58c9c7d71b4f0a4a8fc51f22c57eedbc8463d5a848fed118d3272be4a`，`contract_artifact.package_uri` 为 `gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/26580019002/mbos-agent-runner-contract-0.1.0.tgz`。本地 runner validations 已在 commit series 前通过：`/tmp/agentsmith-tools/actionlint .github/workflows/runner-image-publish.yml`、`bash scripts/verify-release.sh --quick`、`bash scripts/verify-release.sh --start-guard`、`bash scripts/test-runner-release-manifest.sh`、`bash scripts/verify-release.sh --image-smoke --artifact-root /tmp/agentsmith-contract-download.BTogDu`、formal artifact root generator integration + `verify-release --release-manifest`、`git diff --check`。旧 publish workflow 的 YAML parse failure 已修复；当前 final run 成功且 check annotations 为空。`actions/download-artifact@v8.0.1` 的 `Buffer()` deprecation 只是非阻断 log line，不是 check annotation。该切片是 focused GHCR publish + manifest artifact evidence，不是 AgentSmith adoption lock、不是 release contract runner digest adoption、不是 release readiness、不是 backend-real、真实 LLM、full runtime semantics，也不是 release-kit/airgap/online deployment readiness。
19. AgentSmith manifest/lock adoption 已完成：positive `runner-release-manifest.valid.json` 使用 final publish run `26582224675` 的 manifest 原文口径，`release_id=p5-publish-8b2541d`，image digest 为 `sha256:26ba63e1e8c92ac9f8499c55bf4aeaf15c463f0e0682eee523268ee84b44fde7`，manifest subject binding sha 为 `sha256:443ca4e58c9c7d71b4f0a4a8fc51f22c57eedbc8463d5a848fed118d3272be4a`，`contract_artifact.package_uri` 为 `gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/26580019002/mbos-agent-runner-contract-0.1.0.tgz`；canonical `agentsmith-runner-image.lock` 已从该 manifest 投影更新。本地 evidence：`npm run test:run -- scripts/governance/__tests__/current-release-boundary-schema.test.ts scripts/contracts/check-runner-image-lock.test.ts scripts/contracts/check-release-boundary-contract.test.ts` passed；`npm run contracts:check-runner-image-lock -- --adoption --manifest scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json` passed；runner repo checker `node /home/percy/works/mbos-v1/agentsmith-runner/scripts/check-runner-release-manifest.mjs --manifest scripts/governance/__fixtures__/release-boundary/runner-release-manifest.valid.json` passed；`npm run contracts:check-engineering-governance` passed；`npm run contracts:check-doc-governance` passed；`git diff --check` passed。
20. Release contract runner digest adoption 已完成：release contract input 只接受 `runnerImageLock`，拒绝 caller-provided `managed_runner_image`；release contract 顶层 `managed_runner_image` 保留 runner artifact identity `agentsmith-runner`，`deploy_image_inventory` 使用稳定 inventory id `managed_runner`，`deploy_template_package.required_image_ids` 包含 `managed_runner`，模板包不再输出长期成功路径 `${{ values.MANAGED_RUNNER_IMAGE }}`。release-kit managed runner image closure consumption 已由下一条完成；该切片本身不是 deployment readiness、不是 airgap/offline package readiness、不是 backend-real、真实 LLM 或 full runtime semantics。
21. release-kit managed runner image closure consumption 已完成：release-kit commit `b83d593 feat: consume managed runner image closure` 已推送到 `agentsmith-project/agentsmith-release-kit` main，remote CI run `26482179772` success。release-kit 消费 AgentSmith release contract 的 dynamic image closure；`managed_runner` 作为普通 digest-bound inventory image 进入 image closure；`required_image_ids`、`deploy_template_package.required_image_ids` 与 `deploy_image_inventory` ids exact-set 对齐。stale six-image、旧 `${{ values.MANAGED_RUNNER_IMAGE }}` 和旧 runner 名只作为 fail-fast 或 negative diagnostics。该切片不是 release readiness、airgap ready、offline package readiness、registry mirror/login/push/pull、deploy adoption/full online adoption/operator full verdict，也不是 backend-real、真实 LLM 或 full runtime semantics。
22. AgentSmith contract 收口已完成：`agent.response.done.payload.usage_tokens` 在 `docs/contracts/agent-execution-protocol.md`、AsyncAPI YAML 和 AsyncAPI JSON 从必填修为可选；缺省表示 runner 未上报真实 usage，runner 不得本地估算；这不是后端行为新增，后端原本已按 optional 处理。
23. DeepSeek/LLM real lane 没有 tracked changes；AgentSmith defaults 和 ignored local env 使用 DeepSeek endpoint/model，LLMUP real smoke 15 passed / 0 failed / 1 skipped，未提交 secret。
24. AgentSmith commit `7cf783c2` 已推送；此前远端 Contracts Check run `26447963233` 因 GitHub Actions checkout/auth 403 失败，不是治理脚本失败。
25. AgentSmith support API / projection contract consistency 当前切片已完成：OpenAPI 已补齐 `/api/v1/context` GET、`/api/v1/context/list` GET 和 `/api/v1/context/managed-credentials/{provider}/refresh` POST 的 200 response schema；`check-runner-support-api-projections` 对三处 response schema 与 `@mbos/agent-runner-contract` 的 `CONTEXT_ENTRY_PROJECTION_JSON_SCHEMA` 做严格比较，`description` 不再忽略；gate 递归拒绝 `context_store`、`writable_scopes`、`managed_credential_refresh`、`credential_files`、`user_bearer_token`；focused 检查 `/api/v1/context` 和 `/api/v1/context/list` 的 `scope` query enum，retired `user` scope 只作为 negative/fail-fast，不是旧 scope 成功路径。本地 evidence：`npm run test:run -- scripts/contracts/check-runner-support-api-projections.test.ts packages/agent-runner-contract/src/support-api-projections.test.ts packages/api-entry-node/src/context-route-handler.test.ts` passed（42 tests passed）；`npm run contracts:check-runner-support-api-projections`、`npm run contracts:check-openapi`、`npm run openapi:check-generated`、`npm run contracts:check` 和 `git diff --check` passed。该切片不是 backend-real、真实 LLM、full runtime semantics、release readiness 或 airgap ready。
26. P5 request-scoped projected dependencies contract/env wiring focused slice 已完成：AgentSmith commit `8c6df24c feat: add runner projected dependency contract` 已推送 main，`TaskExecutionContext` 新增 optional `projected_dependencies`，runtime guard/schema/AsyncAPI/协议文档同步，`projected_dependencies.dependencies.*.fields` 继续拒绝 `context_store`、`writable_scopes`、`managed_credential_refresh`、`credential_files`、`user_bearer_token`；本地 evidence：`npm run test:run -- packages/agent-runner-contract/src/protocol.test.ts packages/agent-runner-contract/src/contract-schema.test.ts packages/agent-runner-contract/src/support-api-projections.test.ts scripts/contracts/check-runner-support-api-projections.test.ts scripts/contracts/check-runner-contract-sync.test.ts` passed（5 files / 70 tests）、`npm run contracts:check-runner-contract-sync` passed、`npm run contracts:check-runner-support-api-projections` passed、`npm run contracts:check-asyncapi-sync` passed、`npm run contracts:check-agent-runner-contract-artifact` passed、`npm run contracts:check` passed、`git diff --check` passed；remote evidence：Contracts Check run `26522251350` success、Image Publish run `26522249787` success、Quality Gates run `26522250713` success（`gate-fast`、`gate-default`、`lane-visual` success，`lane-backend-real-core` skipped by workflow condition）。Runner repo commit `c67e837 feat: pass projected dependencies env` 已推送 main，`buildAgentRuntimeEnv` 始终输出 `MBOS_AGENT_PROJECTED_DEPENDENCIES`，存在时序列化 `executionContext.projected_dependencies`，否则输出空字符串防 parent env leakage；只提供 bulk opaque env，不新增 per-dependency env，不定义 Context Store / managed credential / scope / write policy 语义。runner 本地 evidence：`npm run check:source-boundary` passed、`npm run typecheck` passed、`npm run test:fast -- src/agent-runtime-env.test.ts` passed（3 tests）、`python3 builtin-skills/mbos-context/scripts/context_cli_test.py` passed（3 tests）、临时安装 AgentSmith 更新后的 contract tgz 后 `bash scripts/test-runner-runtime-fast.sh` passed（17 TS test files / 155 tests + builtin skill Python tests 3+2+4）、`npm run build` passed、`bash scripts/verify-release.sh --start-guard` passed、one-off contract-to-env smoke passed、`git diff --check` passed；remote evidence：runner CI run `26522674596` success（`Quick governance`、`Runner skeleton start guard`、`Runner image smoke` success）。release-kit side KISS check found no docs/gates needing sync and no release-kit changes. 该切片不是 release readiness，不是 deployment/offline/airgap readiness，也不是 AgentSmith full adoption；旧字段/旧职责继续 fail fast，不作为 legacy 成功路径。
27. P5 runner focused image task-execution smoke 已完成：runner repo commit `7a98d40 feat: add runner image task execution smoke`，remote CI run `26616757307` success，jobs `Quick governance`、`Runner skeleton start guard`、`Runner image smoke` success。本地 evidence：`bash scripts/verify-release.sh --quick` passed、`bash scripts/verify-release.sh --start-guard` passed、`bash scripts/test-runner-runtime-fast.sh` passed、`npm run check:source-boundary` passed、`bash -n scripts/verify-release.sh scripts/test-runner-image-task-execution-smoke.sh` passed、`node --check scripts/runner-task-execution-smoke.mjs` passed、`git diff --check` passed、`bash scripts/verify-release.sh --image-task-execution-smoke --artifact-root /tmp/agentsmith-runner-contract-artifact.valid.caD2Wl` passed。该 smoke 覆盖真实 built image `/app/dist/index.js` -> local WS harness -> fake Codex -> artifact/done，且 build context 最小、sentinel scan fail-closed、container early exit fail-fast。它已完成 fake-Codex focused task-execution image smoke；仍不是 backend-real、真实 LLM、release readiness、AgentSmith adoption、GHCR publish 或 full runtime semantics。
    AgentSmith `--runner-projection-smoke` canonical lock truth 已完成 local focused evidence passed：`npm run test:run -- scripts/internal-backend-real-gate-runtime.test.ts scripts/contracts/check-runner-image-lock.test.ts` 和 `npm run contracts:check-runner-image-lock`。未传 `INTEGRATION_INTERNAL_AGENT_IMAGE` 时自动使用 `scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock` 的 digest image，默认 `INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0`；显式 image mismatch、legacy image/path 或 build 非 0 fail fast。未引入第二 lock path；这不是 release readiness、deploy verdict 或 package readiness，本轮不写 remote evidence。
28. release-kit P3 airgap focused deployment gate 已完成：release-kit commit `73c3dac feat: add airgap deployment focused gate` 已推送到 `agentsmith-project/agentsmith-release-kit` main；remote CI run `26618755877` success，job `quick-boundary` success，包含 `Airgap deployment gate focused guard` success。本地 evidence：`bash scripts/test-airgap-deployment-gate.sh`、`bash scripts/test-airgap-image-load.sh`、`bash scripts/test-airgap-bundle-render-check.sh`、`bash scripts/test-apply.sh`、`bash scripts/test-rollout.sh`、`bash scripts/test-smoke.sh`、`bash scripts/test-online-deployment-gate.sh`、`bash scripts/test-evidence.sh`、`bash scripts/verify-release.sh --quick`、`npm run contracts:check-release-kit-source-boundary -- --scan-root /home/percy/works/mbos-v1/agentsmith-release-kit`、syntax checks 和 `git diff --check` passed。新增 `--airgap-deployment-gate` 只支持 `existing_kubernetes/external_declared/airgap`；server-dry-run 只做 target-preflight + bundle render-check + apply server dry-run；confirmed apply 需要 archive probe、image loader、matching confirm profile 和 `operator_run_id`，运行 image-load + render-check + apply + rollout + optional smoke。报告 `readiness:false`，`airgap-deployment-gate-report.json` 仍被 `--evidence` 拒收；它不是 offline install/package/deploy/release readiness、不是 registry mirror/login/push/pull、不是 substrate install、不是 operator signature/identity/full verdict。本次治理收敛只记录执行计划，不更新 `docs/项目宪法.md`；release-kit 同步把 quick-governance 命名降为 quick-boundary，并删除 kind mandatory rehearsal 暗示。

1. 部署/运维复审结论：当前 `existing-cluster` 只能命名为 Docker substrate/IP-only transition diagnostic。它不等于真实 Kubernetes/cloud/airgap substrate，也不能进入 AgentSmith `release:ready` 结论。真实 online/airgap/cloud substrate 由 release-kit repo-local gate 暴露；AgentSmith 侧只能降级展示、显式命名、误用就 fail fast。
2. Release kit image inventory guard 已收口：本切片已补齐 `deploy_template_package.required_image_ids` 与 `deploy_image_inventory` 的模板 image 范围双向一致性；P3 valid fixtures 曾升级到 6 个 app-current image ids，并在 inputs/template-package/airgap-bundle-check/image-map/render 关键入口做 `required_image_ids` exact-set closure；当前规范口径已由 release-kit managed runner image closure consumption 切换为 dynamic release contract image closure，`managed_runner` 作为普通 digest-bound inventory image 参与 exact-set，不把 6-image 或 7-image 写成长期固定清单。release contract generator/check 必须覆盖所有模板 image 引用；缺失、orphan image truth、required ids 不存在于 `deploy_image_inventory` 或 pre-GA 旧 3-image 输入都停止。P2 online gate base sequence 已覆盖 `inputs,target-preflight,template-package,image-map,render,render-check,apply,rollout,smoke`，render 使用 image-map target refs；rollout 对 render/check `matched_by === 'digest'` 的 target/adopted refs 做 strict live ref check，同 digest mixed source+target fail；target/adopted refs 如果 selected pods 只暴露 expected digest、没有可解析 digest-pinned live image ref，也 fail fast；普通 source-registry rollout 保持 digest-only。target-registry apply 的 registry presence 已绑定到 online gate，必须在 image-map 后、render/apply/rollout/smoke/evidence 前通过只读 probe 检查：`target_image` 必须等于 deterministic mirror ref，probe 返回 digest 必须等于 target digest；source-registry apply 不受影响，target-registry server-dry-run 不要求且不允许 probe。它仍不是 registry mirror/login/push/pull、deploy adoption 或 release readiness。operator signoff intake focused guard 已完成，但 operator signature/identity/full verdict（正式签名验证、身份系统、完整 operator verdict）不在本切片内。
3. Release kit 复审结论：`--evidence` 只能接受当前 producer 能重新语义校验的 focused output：`image-map.json`、`online-deployment-gate-report.json`、`airgap-bundle-check-report.json` + `airgap-bundle-manifest.json` + `image-map.json`。其中 `image-map.json` 是 mirror/image-map focused diagnostic 的 accepted/revalidatable focused output；image-map-only 不等于 deploy/package/operator verdict 或 release readiness，`--evidence` 接受它只表示重新语义校验 mirror/image-map focused diagnostic，不代表部署成功。online target-registry evidence root 只是 envelope/container，内含 `evidence.json`、`evidence-subject.json` 和 `online-deployment-gate-report.json`，可被 `--evidence` revalidate，但不列为 machine accepted focused output 值；online gate report 若含 image-map，必须使用 canonical `image-map,registry-presence` producer sequence。`airgap-bundle-render-check-report.json`、`airgap-image-archive-check-report.json`、`airgap-image-load-report.json`、`airgap-deployment-gate-report.json`、`substrate-routability-report.json` 和 standalone `registry-presence-report.json` 虽已有 focused diagnostic/producer，但仍是 `readiness=false` 诊断输出，`--evidence` 继续拒收。operator signoff intake 也接受该 canonical target-registry sequence。未来/预留 output 不预留长期发布/部署契约，未实现或未接入 `--evidence` 语义校验就 fail fast。`--inputs` / `--evidence` / `--operator-signoff-intake` 的已实现输出、拒绝条件和 `readiness=false` 边界已随 P2 online apply/evidence spine、registry presence binding、operator signoff intake focused guard、P3 render-check focused diagnostic、P3 app-current image inventory closure、P3 airgap image archive materiality focused diagnostic、P3 airgap image load/import focused diagnostic、P3 airgap focused deployment gate 与 P3 substrate routability focused producer 阶段性收紧；后续继续 P2 full online adoption、AgentSmith product-flow evidence 和 airgap full offline install/package/adoption readiness 剩余工作。release-kit operator signature/identity/full verdict（正式签名验证/身份/完整 verdict）deferred：只有出现明确客户/合规/发布消费方需要时再做，真实 deploy/smoke 站稳前不推进。
4. Runner 复审结论：P4 AgentSmith formal artifact producer/checker 已完成，正式 artifact 是外部 `runner-contract-artifact.json` + tgz；P5.0 runner repo consumer diagnostic skeleton 已完成并可消费正式 artifact；P5.1 start guard/CI 化已完成；P5.2 formal artifact handoff 已完成并验证，只证明 AgentSmith producer 产物能被 runner repo consumer 消费；P5.3a release manifest skeleton/checker/start-guard 集成已完成，只证明 manifest skeleton 可校验、可接入 start guard、full release gate fail-closed；P5.3b first half 已完成 runner repo-local runtime source、runtime fast focused diagnostic，并推进到 projection-only / contract-only / policy-local boundary closure；P5 focused image build/start smoke 已完成；P5 runner publish manifest focused evidence 已完成，final runner HEAD 是 `8b2541d`，final publish run `26582224675` success；AgentSmith manifest/lock adoption、release contract runner digest adoption、release-kit managed runner image closure consumption、AgentSmith support API / projection contract consistency focused gate、P5 request-scoped projected dependencies contract/env wiring focused slice、P5 runner focused image task-execution smoke 和 AgentSmith `--runner-projection-smoke` canonical lock truth 已完成。下一步不是 release readiness，而是 full runtime semantics 后续专项和 P2/P3 deployment/operator/adoption 收口，按 KISS 小切片推进。
5. Runner 迁移结论：旧 `@mbos/agent-runner` shim 不能成为长期共享路径、正式路径或 release proof；projected dependencies 已由 runner repo `buildAgentRuntimeEnv` 输出 `MBOS_AGENT_PROJECTED_DEPENDENCIES` opaque bulk env，fake-Codex focused task-execution image smoke 已完成，AgentSmith `--runner-projection-smoke` 现在只接受 canonical `agentsmith-runner-image.lock` digest image 且默认不 build，但 broader runtime semantics、HOME/TASK_HOME、credential non-persistence、backend-real、真实 LLM 和 adoption 串联仍待后续 P5 小切片收口。P5 image smoke 不是正式 runner image/adoption；P5 publish manifest evidence 本身也不是 AgentSmith manifest/lock adoption 或 release readiness，不能单独作为 release proof；AgentSmith release contract runner digest adoption 后，release-kit managed runner image closure consumption 已完成，但这仍不是 release readiness、airgap/offline package readiness、backend-real、真实 LLM 或 full runtime semantics。
6. 旧输入复审结论：项目仍 pre-GA，旧命名、旧路径、旧职责、旧入口、旧文档/旧脚本引用、旧 env/profile 别名、已移除旧包和已移除字段默认删除或 fail fast，不作为长期可用路径或长期发布/部署契约。只有负向测试、失败边界、过渡期专项诊断或 operator 短期说明确实需要临时兼容时才短期保留；任何短期待删项都必须挂 owner、删除条件、删除时机/阶段和验收证据，并在 P2/P5/P6 删除或归位。

## P6-lite 最新降噪证据 / 2026-05-29

以下内容是 latest handoff evidence reference，不是 active plan 或 release readiness。

1. AgentSmith link-level `release-kit-online-adoption-handoff` validator 已完成：commits `9fa11298 feat: validate online adoption handoff links` 和 `914244a5 test: fail fast malformed online handoff contract`。Focused test 结论：覆盖 digest/provenance/link 级 handoff happy path、malformed contract fail fast、且 current verification campaign 不把该 validator 接入 `release:ready` / `contracts:check`。
2. P6-lite summary/status 降噪已完成：commits `d2e38da3 test: hide transition deploy diagnostics from release status` 和 `6b72a8f3 test: align clean release status diagnostics`。Focused test 结论：默认 `release:ready` / `release:status` human output 不再展示 transition-only unified deploy diagnostics，release-kit focused evidence 不再作为 product readiness summary item 展示。

## 历史详细问题原文 / 当时使用的防漂移问题

以下内容是历史 reference，用于还原当时使用的防漂移问题原文；不是当前每次切片默认必答 gate。

1. 这次改动有没有新增用户概念？
2. 有没有把产品证据搬出 AgentSmith？
3. 有没有引入 tag-only image？
4. 有没有让 release kit import AgentSmith 产品源码？
5. 有没有让 runner repo 解释 Context Store、Files 或 managed credentials 权限？
6. 有没有把本地开发 override 当成 release proof？
7. 有没有把 release kit 产物当成新的 AgentSmith `release:ready` verdict？
8. 有没有把 kind 当成部署必需条件？
9. 有没有把云端支持写成云资源管理产品？
10. 有没有新增 substrate provider abstraction？
11. 有没有把 local-kind evidence 当成 real Kubernetes/cloud evidence？
12. 有没有让 runner contract 出现 package、AsyncAPI、文档三套机器真相？
13. 有没有接受缺 provenance、local provenance 或 non-canonical pre-GA `agentsmith-codex-runner` producer？
14. 有没有把明文 secret 写进 evidence、日志或 release summary？
15. 有没有把 AFSCP/ASBCP family reference 从新 repo bootstrap 治理做法参考扩大成源码依赖、合同依赖、gate 依赖或新治理平台？
16. 新增 repo、新增 release gate family 或新增职责边界时，有没有先做 bootstrap-only/docs-governance-first PR？已 bootstrap repo 的普通功能切片有没有保持最小 contract/test/evidence？
17. 有没有把 quick gate 或 team signoff 当成 release readiness / release gate？
18. 有没有复制 AFSCP/ASBCP gate 脚本作为权威 gate，或把 sibling repo status 当成 gate？
19. 有没有让 `--inputs` / contract intake 的 `intake-report`、`image-digest-plan`、standalone render/apply/rollout/smoke report、P3 `airgap-bundle-render-check-report.json`、`airgap-image-archive-check-report.json`、`airgap-image-load-report.json` 或 `registry-presence-report.json` 变成 deploy/package/operator verdict 或 AgentSmith product gate，或让 `--evidence` 接受未实现/不能重新语义校验的 output？
20. 有没有让 runner repo 新定义 Context Store scopes、Files/file-library 行为、managed credential resolution、execution ticket 颁发或权限语义，或让 `mbos-context` 定义这些 policy？
21. 有没有让 runner repo 正式路径 import `@mbos/*` 中除 `@mbos/agent-runner-contract` 以外的包？
22. 有没有把 `existing-cluster` 诊断、`site.env.example` 或源码 build runner image 当成正式 release proof？
23. 有没有让 `deploy_template_package.required_image_ids` 与 release contract image inventory 的模板 image 范围脱节？
24. 有没有让旧 `@mbos/agent-runner` shim、旧 env helper 或 monorepo-side `buildAgentRuntimeEnv` 形成长期共享路径、正式路径或 release proof？
25. 有没有保留未挂 owner、删除条件、删除时机/阶段和验收证据的 pre-GA 已移除输入、旧路径/旧文档/旧脚本引用或短期待删说明？
26. 有没有把 P2 online evidence root envelope、`--registry-presence`、`--registry-probe` 或 `--operator-signoff-intake` 写成 registry mirror/login/push/pull、deploy adoption、cloud provisioning、full online adoption、release-kit operator signature/identity/full verdict（正式签名验证/身份/完整 verdict）、AgentSmith product-flow evidence 收口或 release readiness？
27. 有没有把 P3 `--airgap-image-archive-check` / `--archive-probe` 写成 probe trust proof、docker/skopeo/oras/kubectl/curl/wget 调用、registry mirror/login/push/pull/import、image load/import/offline install/apply/smoke、airgap ready 或 release readiness，或者把 P3 `--airgap-image-load` / `--image-loader` 写成 release-kit 选择 Docker/skopeo/oras/kubectl/registry credentials、offline install/apply/smoke、registry readiness、airgap ready 或 release readiness，或者把 `--substrate-routability` / `--routability-probe` 写成 substrate installer、deploy/package/release readiness 或 release-kit operator verdict？
28. 有没有把 P5.2 formal artifact handoff 写成 runtime/image/adoption/release readiness，或在 `runner-repo-contract-handoff` 混入 signing/attestation/downloader？
29. 有没有把 P5.3a release manifest skeleton/checker/start-guard 写成 runtime migration、image build/publish、AgentSmith adoption、lock update、可下载 artifact 内容 hash / 远端 artifact digest 证明或 release readiness，或者保留 `agent-task-runner` 旧别名、发明 `descriptor_uri` / `descriptor_sha256` 字段？
30. 有没有把 P5.3b first half runtime fast/source-boundary/boundary closure 写成 image build/publish、Dockerfile migration、AgentSmith adoption lock、release contract digest adoption、release readiness，或者把已由 AgentSmith gate 切片收口的 support API / projection contract consistency 归因给 runner repo / P5.3b，或者把 workspace-access/file-library product API、AFSCP binding schema、release fence payload、file-library reserved namespace policy、`usage_tokens` 本地估算/伪造、普通 `npm install` 写成 runner repo 正式职责或 `@mbos/agent-runner-contract` 消费证据？
31. 有没有把 P5 focused image smoke 写成 GHCR publish、registry login、release manifest/image digest、AgentSmith adoption lock、release contract runner digest、release readiness、fake-Codex task-execution image smoke，或把 AgentSmith product semantics 迁入 runner repo？
32. 有没有把 P5 runner publish manifest evidence 写成 AgentSmith adoption lock、release contract runner digest adoption、release readiness、backend-real、真实 LLM、full runtime semantics、release-kit/airgap/online deployment readiness，或恢复旧别名 / latest / `agent-task-runner` / `agentsmith-codex-runner` 作为正式成功路径？
33. 有没有把 release-kit managed runner image closure consumption 写成 release readiness、airgap ready、offline package readiness、registry mirror/login/push/pull、deploy adoption/full online adoption/operator full verdict、backend-real、真实 LLM、full runtime semantics，或把 stale six-image、旧 `${{ values.MANAGED_RUNNER_IMAGE }}`、旧 runner 名写成正式成功路径？
34. 有没有把 P5 request-scoped projected dependencies contract/env wiring 或 AgentSmith `--runner-projection-smoke` lock truth 写成 fake-Codex task-execution image smoke、release readiness、deployment/offline/airgap readiness、deploy verdict、package readiness、AgentSmith full adoption，或让 runner repo 解释 Context Store / managed credential / scope / write policy 语义、接受旧字段/旧 image/build 路径作为 legacy 成功路径，或引入第二 runner image lock path？
35. 有没有新增不服务当前功能、当前安全、真实运行/发布安全或 operator 低心智的长期 gate/docs/script，或者把过时低收益治理项升级为长期 gate 而不是删除/降级 focused diagnostic？

当时若任一答案为“有”，则回到边界评审；当前 active 审查以主计划 invariant 为准。
