# Notebook Terminal Release Evidence

## 摘要

`Notebook Terminal Session` 已作为 notebook task 内的正式工作面交付：

- terminal 与 agent run 是两个独立对象
- 用户访问入口集成在 task 主界面
- external / internal 使用同一套 runner terminal 协议与产品语义
- terminal 采用 `node-pty`，不再依赖 `script(1)` workaround

## 产品规则

- `Hide Terminal` 只收起 terminal 工作面，不结束当前 shell
- panel 内 `Close terminal` 才会显式结束当前 terminal session
- internal terminal 与 conversation 一样，会自动准备运行环境
- terminal session 内 shell 状态连续
- terminal session 与后续 agent run 不共享隐式 shell 状态
- terminal 默认运行在 runner 工作用户下，不承诺 `sudo`
- 长运行前台程序支持 `Ctrl-C` / `Ctrl-D`
- 浏览器刷新或短时断线后，系统会优先恢复当前 terminal session
- terminal 若被另一个浏览器标签页接管，当前页面会显示友好提示

## 工程门禁

发布前应通过以下门禁：

```bash
cd /home/percy/works/mbos-v1/agentsmith
npx tsc --noEmit
npm run test:notebook:backend-real:terminal:matrix
npm run test:e2e:integration:notebook:terminal:ux
```

## backend-real 证据

`test:notebook:backend-real:terminal:matrix` 串行验证：

- external terminal real smoke
- internal terminal real smoke

smoke 行为覆盖：

- `pwd`
- `export NOTEBOOK_SESSION_VAR=terminal_session_value`
- 同一 session 里读取变量
- `sleep 30` 后发送 `Ctrl-C`
- 新 session 中变量重置为 `unset`

验收结果：

- terminal cwd 落在 task workspace
- session 内 shell 状态连续
- session 外不继承临时 shell 变量
- 长运行前台程序可以被中断

## Visual / UX 证据

`test:e2e:integration:notebook:terminal:ux` 覆盖 3 个真实用户场景：

1. active terminal
2. connecting / warmup
3. failed / unavailable

关键截图：

- `test-results/integration-notebook-termi-e1a4d-sion-with-real-shell-output-chromium/notebook-terminal-active.png`
- `test-results/integration-notebook-termi-e1a4d-sion-with-real-shell-output-chromium/notebook-terminal-closed.png`
- `test-results/integration-notebook-termi-e1a4d-sion-with-real-shell-output-chromium/notebook-terminal-closed-after-session.png`
- `test-results/integration-notebook-termi-e1a4d-sion-with-real-shell-output-chromium/notebook-terminal-input-blocked.png`
- `test-results/integration-notebook-termi-27f25-mup-retries-are-in-progress-chromium/notebook-terminal-connecting.png`
- `test-results/integration-notebook-termi-30e8e-rminal-creation-is-rejected-chromium/notebook-terminal-failed.png`

复审结论：

- 普通用户能区分 `Hide Terminal` 与 `Close terminal`
- active 态下 task 主界面与 terminal 的控制权关系清楚
- failed 态使用普通用户语言，不暴露原始错误码
- connecting 态不会误导成页面故障

## 已知边界

- v1 不承诺 `sudo`
- v1 不承诺多标签页共享同一个 terminal；同一 terminal 被接管时，以最新标签页为准
- v1 重点保证 session 内连续，不保证跨 session 保留临时 shell 状态
