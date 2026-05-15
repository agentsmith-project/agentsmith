# File Library User Story E2E Hardening Plan

更新时间：2026-05-11
状态：`superseded_by_direct_restore`
适用范围：Files 文件库、Agent task HOME、save point/restore、task file template、task 与文件库绑定生命周期，以及这些功能的 focused user-story E2E/组件验收。

> Superseded notice: restore 相关实现以
> [`file-library-fast-save-restore-simplification-plan-v1.md`](./file-library-fast-save-restore-simplification-plan-v1.md)
> 为准。当前 active flow 是：用户选择 save point -> 确认未保存到 save point 的当前文件改动会被丢弃 -> 后端启动 direct restore operation。不要按旧 preview-first/run/cancel 心智继续实现或验收。

## 0. 目标

这份计划用于补齐文件库存储重构后的用户故事验收缺口。它不是扩大测试范围，而是把开发测试团队需要确认的产品心智、阻断文案、证据路径收敛到可实现状态。

核心目标：

- Files 打开的是 file library HOME root。文件库绑定 task 时，这个 HOME root 等同该 task HOME；未绑定文件库不是某个 task 的 HOME。
- 用户在 Files、Agent task、terminal 之间切换时，看到的是同一份 HOME payload 文件状态，而不是 `workspace/` 的局部视图。
- save point、restore、task file template、binding reuse 都按 whole HOME payload 处理；非文件 payload 的 task 消息、trace、terminal、runner binding、artifact metadata 不被继承。
- 错误与 pending 状态要用 typed blocker copy 表达，不把所有问题都写成 ask admin。

后续实现应以 focused user-story E2E、组件/错误映射测试和必要的 backend-real smoke 补证。不要用 full visual catalog、release ready 或全量重门禁替代这些具体用户故事。

## 1. 用户心智决策

### 1.1 文件库根目录与 dot folders

Files 默认打开 file library HOME root。`workspace/` 是 HOME 里的普通工作目录，terminal/agent 的默认 `cwd` 指向它，但 Files 作为文件库浏览器必须忠实展示 HOME root。

当文件库绑定到 task 时，file library HOME root 等同 task HOME。普通 Files 文件库、已释放文件库、模板源文件库都不应被文案写成“某个 task HOME”，除非当前上下文确实绑定了 task。

Dot folders 采用“存在即展示、不做通用过滤”的原则：

- `.codex/`、`.agents/`、`.mbos/`、`.cache/`、`.config/`、`.local/` 等只是常见 runtime/system dot folder 示例，不表示每个 HOME 必然存在。
- 后端列出什么，前端就展示什么；前端不得通过通用 dot folder 过滤隐藏用户、agent 或 runtime 创建的目录。
- 当前阶段采用低心智 UX guard：对已知 top-level runtime/system dot folders 做标识；删除、移动或重命名这类目录时需要二次确认，或在后端返回 protected/in-use blocker 时禁用。不要用“隐藏目录”替代 guard。

### 1.2 Save point 与 restore

Save point 和 restore 覆盖 whole file library HOME payload，不是当前打开目录，也不是只覆盖 `workspace/`。`workspace/.artifacts/` 里的文件是普通 HOME payload 文件，参与 save point、restore、template clone 和 binding reuse。

Restore 不会为了恢复而隐式保存当前状态。用户如果想保留当前文件，必须取消恢复并主动创建 save point：

- 普通 save point 列表只展示用户主动创建的 save point，以及明确属于用户可选择恢复点的后端结果。
- 恢复确认文案必须说明：未保存到 save point 的当前文件改动会被丢弃。
- 恢复确认后，后端启动 direct restore operation；前端展示 operation/pending/restoring 状态。

Direct restore operation 可能是异步操作。UI 不能在 restore 仍 pending 时给“已恢复成功”的心智；必须显示“正在恢复/收敛”或等价状态，并轮询/refetch 到终态后再展示成功。失败、out-of-date restore state、active writer、project storage not ready 都必须用 typed blocker 表达。

### 1.3 Task file template

发布 task file template 时，模板捕获“用户点击发布当下”的文件状态。后续源文件库变化不会改变已发布模板内容。

从模板创建 task 是独立克隆：

- 新 task 获得新的 file library id。
- 克隆继承 HOME payload 文件，包括 `workspace/.artifacts/` 里的普通文件。
- 克隆不继承旧 task 消息、trace、terminal、runner binding、active lease、artifact metadata、Project secrets、tickets、managed OAuth credentials 或 internal storage-control metadata。
- unpublish/delete template 只影响未来使用，不影响已经克隆出来的 task/file library。

### 1.4 文件库绑定生命周期

同一个文件库在同一时间只能绑定到一个未删除 task。停止、结束、失败或关闭运行不等于释放绑定；只有删除 task 并完成后端 release/drain 后，文件库才可作为已释放 HOME payload 被新 task 显式复用。

复用只继承 HOME payload 文件。旧 task 的消息、trace、terminal、runner binding、artifact metadata 和 runtime holder 不进入新 task。`workspace/.artifacts/` 中的文件如果还在 HOME payload 里，则作为普通文件保留，但不代表旧 task artifact metadata 也被继承。

### 1.5 Typed blocker copy

错误文案按用户下一步分流，不统一写成 ask admin：

| Typed state / error | 用户心智文案边界 | 主要动作 |
| --- | --- | --- |
| capability denied | 当前项目不支持这个文件状态能力；如果预期可用，才提示联系管理员启用项目能力 | 返回/重试入口保持安全，不丢表单 |
| project file storage not ready | 项目文件存储正在初始化、重试或暂不可用；只有 blocked-needs-admin 才提示管理员处理 | 等待、刷新、稍后重试 |
| operation pending / restore pending | 已提交但仍在恢复/收敛，不能立即宣称成功 | 显示进度、轮询终态、必要时允许用户稍后重试 |
| library in use | 文件库仍被未删除 task 占用；停止运行不释放绑定 | 打开/删除对应 task，等待 release 完成 |
| restore state changed / active writer | 恢复请求已不再适用，或仍有写入会话 | 重新打开 File states、停止写入会话、稍后重试 |

## 2. Reviewer Findings 复核结论

| Finding | 结论 | Handoff 决策 |
| --- | --- | --- |
| dot folders 需要可见性保护 | 成立但需收敛 | 改为“存在即展示、不通用过滤”；示例不表示必然存在；runtime/system dot folders 用低范围 UX guard |
| Files 根目录不能都写成 task HOME | 成立 | 普通 Files 是 file library HOME root；绑定 task 时才等同 task HOME |
| 绑定复用语义需更精确 | 成立 | 未删除 task 独占；删除 task 后释放；停止/结束不释放；复用只继承 HOME payload |
| save point/restore scope | 成立 | restore 覆盖 whole HOME；direct restore 不隐式创建 current-state save point |
| restore operation pending 不能立即成功 | 成立 | pending 展示“正在恢复/收敛”，终态成功后才给成功心智 |
| template 点击时快照与 clone independence | 成立 | 发布模板取点击当下文件状态；后续源变化、unpublish/delete 不影响已克隆 task |
| capability denied 测试不要过度 E2E | 成立 | 保留组件/错误映射测试；只有主路径稳定可复现时加最小 UI E2E |
| 错误文案不能全是 ask admin | 成立 | 拆分 capability、storage not ready、pending、in-use、out-of-date restore/active writer |

## 3. 必补 User Stories

### Story A: Save point restore whole-HOME 闭环

用户故事：

> 作为使用 Files 管理文件库的人，我创建 save point，修改或删除 HOME payload 文件，再从 save point 恢复。我期望恢复后 Files 里直接看到 whole HOME 文件状态回到保存点。

步骤：

1. 创建或打开一个 ready file library。
2. 在 HOME root 下创建 `root-restore-target.txt`，内容为 `before restore`。
3. 在 `workspace/docs/restore-target.txt` 创建内容 `before restore`。
4. 创建用户 save point。
5. 修改两个文件为 `after mutation`，或删除其中一个。
6. 从该 save point 点击 restore。
7. 确认弹窗说明 current file changes not saved to a save point will be discarded。
8. 点击确认 direct restore。
9. 如果 restore operation 返回 pending，UI 显示“正在恢复/收敛”类状态，不能显示成功。
10. 等待终态成功后，回到 Files 浏览器并刷新/refetch。
11. 验证两个文件存在且下载内容均为 `before restore`。

验收标准：

- restore 覆盖 whole HOME payload，不只覆盖当前目录或 `workspace/`。
- UI 成功心智只在 restore terminal success 后出现。
- restore operation 期间模板发布和 destructive mutation 入口被 typed blocker 阻断；恢复完成后解除阻断。
- 页面不展示 raw storage-control/storage-backend id、storage path、内部 token 或原始错误码。

### Story B: Task file template 点击时快照与独立克隆

用户故事：

> 作为项目成员，我把当前文件库发布成 task file template，再从模板创建新 task。我期望新 task 获得点击发布当下的独立文件副本。

步骤：

1. 在源 file library 写入 `template-seed/guide.md`，内容为 `template version 1`。
2. 打开 File states 里的 Task file templates。
3. 点击发布当前 file library 为项目 task file template。
4. 发布完成后，把源 file library 同一路径改为 `template source changed`。
5. 从已发布模板创建新 Agent task。
6. 打开新 task 绑定的 file library。
7. 验证新 file library id 不同于源 file library id。
8. 验证 `template-seed/guide.md` 可见，下载内容仍为 `template version 1`。
9. 在新 task file library 修改同一路径为 `clone changed`。
10. 回到源 file library，验证源内容仍为 `template source changed`。
11. unpublish 或 delete template 后，验证已克隆 task 的文件库仍可浏览且内容不变。

验收标准：

- 模板发布取点击当下文件状态。
- clone 后源 file library 与新 task file library 互不影响。
- unpublish/delete template 只影响未来使用，不影响已克隆 task。
- 模板只在当前 project 范围可见，不引入成员/组共享。

### Story C: HOME root 与 dot folders 存在即展示

用户故事：

> 作为调试 agent 执行结果的人，我在 HOME 下看到 runtime 或用户创建的 dot folders。我期望 Files 里也能看到这些已存在目录，而不是被产品隐藏。

步骤：

1. 创建 Agent task 并等待 file library ready。
2. 通过 terminal 或 managed-runner smoke 写入本故事需要的目录和文件：
   - `$HOME/.codex/e2e.json`
   - `$HOME/.agents/e2e.txt`
   - `$HOME/workspace/.artifacts/result.txt`
   - `$HOME/root-visible.txt`
3. 打开该 task 绑定的 file library。
4. 验证 HOME root 展示 `.codex`、`.agents`、`workspace`、`root-visible.txt`。
5. 进入 `.codex/` 和 `.agents/`，验证测试文件可见并可下载。
6. 进入 `workspace/.artifacts/`，验证产物文件作为普通文件可见。
7. 对 `.codex/` 或 `.agents/` 触发删除/移动/重命名入口时，验证当前选定 UX guard 生效：有 runtime/system 标识、二次确认，或后端 blocker 禁用。

验收标准：

- E2E 只断言测试创建的 dot folders，可避免暗示每个 HOME 必然存在所有 runtime folders。
- Files 不做普通 dot folder 过滤。
- HOME root 默认可见；`workspace/` 不被伪装成文件库根。
- Runtime/system dot folders 通过低范围 guard 降低误删风险，不能通过隐藏来实现。

### Story D: 文件库绑定独占、释放与复用

用户故事：

> 作为连续工作的用户，我删除旧 task 后，希望保留文件库内容，并在新 task 创建时显式复用这份 HOME payload。

步骤：

1. 创建 task A，生成并绑定 file library L。
2. 在 L 写入 `carry-over/notes.md` 和 `workspace/.artifacts/result.txt`。
3. 如果产品支持停止/结束 task A，先停止或结束它；验证 L 仍显示为 bound，不可复用。
4. task A 未删除时，尝试用 L 创建 task B。
5. 验证创建被拒绝或 UI 禁止选择，文案说明 L 正在被 task A 使用。
6. 删除 task A，并等待后端 release/drain 到 L 可复用终态。
7. 创建 task B，并显式选择已释放的 L。
8. 打开 task B 的 file library，验证 `carry-over/notes.md` 和 `workspace/.artifacts/result.txt` 仍存在。
9. 验证 task B 不继承 task A 的消息、trace、terminal、runner binding 或 artifact metadata。
10. task B 未删除时尝试删除 L。
11. 验证删除被拒绝，文案说明文件库正在被未删除 task 使用。

验收标准：

- 绑定独占由后端保证，前端禁用只是辅助。
- 停止/结束运行不释放绑定；删除 task 并完成 release/drain 后才释放。
- 复用只继承 HOME payload 文件；`workspace/.artifacts/` 文件是普通文件保留，artifact metadata 不继承。
- 删除文件库不能卡在永久 `deleting`；pending 必须收敛到明确终态或可操作 blocker。

### Story E: 用户可理解的 typed blocker copy

用户故事：

> 作为普通用户，我遇到文件状态功能不可用、项目文件存储未就绪、恢复未结束、模板发布冲突或文件库被占用时，界面能告诉我原因和下一步，而不是显示内部错误码。

覆盖点：

- `FILE_LIBRARY_CAPABILITY_DENIED` / `file_library_capability_denied`
- project file storage `bootstrapping` / `retryable_failed` / `blocked_needs_admin`
- `FILE_LIBRARY_RESTORE_PREVIEW_ACTIVE` legacy typed code, rendered with direct restore operation copy
- `FILE_LIBRARY_OPERATION_PENDING` plus front-end compatibility alias `FILE_LIBRARY_RESTORE_OPERATION_PENDING`
- `AGENT_TASK_FILE_LIBRARY_IN_USE`
- `FILE_LIBRARY_TASK_IN_USE`
- out-of-date restore state / active writer blocker

验收标准：

- 页面主文案不显示 raw code。
- 表单输入不丢失，用户能返回、重试或等待终态。
- pending 状态展示等待/收敛，不展示成功。
- capability denied 保留组件测试和错误映射测试；只有当主路径稳定、可复现、不会依赖临界竞态时，再加最小 UI E2E。

## 4. 测试落地策略

### 4.1 优先扩展现有 focused user-story E2E

优先扩展 `e2e/integration-files-user-stories.spec.ts`，不要新增大型重套件。它已经覆盖 Files、save point、task template 和 Agent task 之间的用户路径，继续使用单一 focused entrypoint 更容易维护。

### 4.2 分层职责

- UI E2E：证明用户能在界面上完成 restore、template clone、HOME root/dot folder、binding reuse 等主路径，并看到符合心智的结果。
- 组件/错误映射测试：覆盖 typed blocker copy、禁用态、pending 文案、表单保留、capability denied。
- backend-real smoke：证明当前 storage-control backed storage、restore、template clone、task HOME binding 行为正确，且无 raw storage 泄漏。
- API contract/openapi：只有公共 API 形状变化时才升级。

### 4.3 建议 focused 命令

开发每个 slice 后优先运行：

```bash
npm run test:e2e:integration:files:user-stories -- --grep "restore"
npm run test:e2e:integration:files:user-stories -- --grep "template"
npm run test:e2e:integration:files:user-stories -- --grep "HOME"
npm run test:e2e:integration:files:user-stories -- --grep "binding"
```

如果涉及后端 storage-control API 适配、save point、restore、template clone 或文件库删除：

```bash
npm run test:files:backend-real:smoke
```

如果涉及 task HOME、terminal、runner holder 或 workspace-access：

```bash
npm run test:files:backend-real:home-binding
npm run test:agent-task:runner:backend-real
```

只有 contract 形状变化时才跑：

```bash
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
```

阶段收口或合并前再根据风险升级到：

```bash
npm run verify -- --goal=pr --run
```

不要在每个小改动后跑 full visual catalog、release ready 或全量部署 smoke。

## 5. 实施顺序建议

1. 先收敛文案与错误映射：typed blocker copy、pending copy、dot folder guard copy、i18n key。
2. 补组件/错误映射测试：capability denied、storage not ready、restore pending、library in use。
3. 补 Story A restore whole-HOME E2E，覆盖 pending success timing。
4. 补 Story B template snapshot/clone independence E2E。
5. 补 Story C HOME root/dot folders E2E，断言“测试创建的 dot folders 存在即展示”。
6. 补 Story D binding reuse/release E2E，确认停止/结束不释放，删除后 release 才可复用。
7. 按改动风险补 backend-real smoke 或 contract gate。

## 6. 文档与合同收敛项

后续实施必须同步保持这些文档/合同一致：

- `docs/contracts/files-frontend-module-map.md`：HOME root 默认、dot folder 可见、whole-HOME save point/restore、template clone independence、binding reuse/release、typed blocker copy 的模块/测试合同。
- `docs/user-guides/file-library-access-model.md`：普通 Files 从 file library HOME root 打开；绑定 task 时才等同 task HOME。
- `docs/engineering/afscp-file-library-runtime-rearchitecture-plan.md`：已被 direct restore simplification plan 覆盖；只可作为历史背景参考，不可按旧 preview-first flow 实施。
- 相关 i18n 文案：不能重新引入 `workspace/` 默认根、所有 Files 都是 task HOME、所有错误都 ask admin 的旧心智。

## 7. 非目标

- 不引入文件级权限、文件级锁或文件级策略。
- 不引入成员/组级模板共享；模板只在 project 内发布和使用。
- 不把 stop/end task 设计成释放文件库绑定。
- 不恢复旧 task 的消息、trace、terminal、runner binding、artifact metadata。
- 不暴露 raw storage-control/storage-backend 路径、bucket、metadata URL、内部 credential 或 storage id 给普通用户。
- 不为 capability denied 等临界态强行增加脆弱 UI E2E；主路径不稳定时用组件和错误映射测试承接。
