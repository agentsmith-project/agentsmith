---
{
  "storyId": "notebook-terminal-reentry-recovery",
  "title": "Notebook terminal re-entry and recovery in the same task",
  "actor": "project member",
  "family": "notebook-terminal-workspace",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}",
  "goal": "项目成员重新进入一个被 terminal work 打断的 notebook task 时，产品必须先 fail-closed 保护任务真相：如果 terminal 仍需恢复或状态已经坏掉，就不能假装 task 已经释放，也不能放行新的创建、run 或删除；用户应该能在同一 task 内重新连接 backend 仍持有的 session id，识别哪一条 terminal 现在需要恢复，结束那条问题 session，并立即开出新的 terminal 继续工作。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible",
    "Keycloak integration users are available"
  ],
  "seedData": [
    "ws_default"
  ],
  "externalDependencies": [
    {
      "dependencyId": "notebook-terminal-runtime",
      "kind": "service",
      "required": true,
      "note": "backend-real terminal recovery story needs a live terminal session service behind notebook tasks."
    }
  ],
  "narrative": "Notebook terminal 的恢复故事必须从用户被打断的真实工作开始，而不是从技术诊断页开始。用户重新进入同一个 task 时，Conversation 仍然是主工作面，但产品必须先诚实地暴露 terminal 真相不可用或仍需恢复的状态，让新的 create/run/delete 都先 fail-closed；如果 backend 仍持有 live session，用户应能回到 Terminal workspace 继续用同一条 session；如果其中一条 terminal 已经坏掉、需要恢复，产品也应该把它作为同一 task 里的待恢复会话呈现出来，让用户在不破坏其他 session 的前提下结束它、清除 blocker，并在同一 task 里立刻开出新的 terminal 接着工作。",
  "scenes": [
    {
      "sceneId": "notebook-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__task-terminal-workspace",
        "notebook__task-terminal-status-strip",
        "notebook__task-header-delete"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "return-to-interrupted-notebook-task",
      "sceneId": "notebook-task",
      "intent": "Return to the notebook task that still has unfinished terminal work attached to it.",
      "action": "Return to the interrupted notebook task",
      "target": "notebook__task-header",
      "expectedFeedback": "用户回到原来的 notebook task，而不是被迫新建一个 task 才能继续处理 terminal 问题。",
      "note": "恢复故事的起点是原任务连续性。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "lose-terminal-connection-without-ending-task",
      "sceneId": "notebook-task",
      "intent": "Experience a broken terminal connection while the task is still owned by terminal work.",
      "action": "Let the terminal connection break without ending the task",
      "target": "notebook__task-terminal-workspace",
      "expectedFeedback": "用户看到的是 terminal 连接出了问题，而不是误以为整个 task 已经结束或释放。",
      "note": "terminal 异常不应被包装成任务已恢复空闲。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reload-task-and-fail-closed-on-recovery-needed-terminal",
      "sceneId": "notebook-task",
      "intent": "Reload or re-enter the task and have the product fail closed until terminal truth is known again.",
      "action": "Reload or re-enter the task while terminal recovery is still needed",
      "target": "notebook__task-terminal-status-strip",
      "expectedFeedback": "页面刷新或重新进入后，界面先明确告诉用户 terminal 仍需恢复，不能假装 task 已经释放。",
      "note": "re-entry 时 fail-closed 比误放行更重要。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "keep-create-run-and-delete-fail-closed-until-terminal-truth-recovers",
      "sceneId": "notebook-task",
      "intent": "Keep create, run, and delete blocked until the product can speak truth about terminal ownership again.",
      "action": "Try to create a new terminal, start a run, or delete the task before terminal truth recovers",
      "target": "notebook__task-header",
      "expectedFeedback": "在 terminal 真相仍未恢复前，新的 create/run/delete 都保持 fail-closed，并给出可理解的恢复指引。",
      "note": "这一步锁的是产品门禁，不是某一个按钮的临时 disabled 态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reopen-terminal-workspace-and-reconnect-existing-session",
      "sceneId": "notebook-task",
      "intent": "Re-enter the terminal workspace and reconnect the still-live terminal session that belongs to this task.",
      "action": "Open terminal workspace again and reconnect the existing terminal session",
      "target": "notebook__task-terminal-status-strip",
      "expectedFeedback": "用户重新进入 Terminal workspace 后，看到的是 backend 仍持有的同一条 session，而不是 silently 新建出来的替身 terminal。",
      "note": "恢复的是原 session id，不是“看起来差不多”的新 terminal。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "confirm-reconnected-terminal-is-still-usable",
      "sceneId": "notebook-task",
      "intent": "Confirm that the reconnected terminal can continue the interrupted work instead of only looking cosmetically restored.",
      "action": "Use the reconnected terminal session again",
      "target": "notebook__task-terminal-workspace",
      "expectedFeedback": "重新连接后的 terminal session 可以继续工作，用户不需要从头再来。",
      "note": "可继续工作比单纯显示“已连接”更关键。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "surface-broken-terminal-session-inside-same-task",
      "sceneId": "notebook-task",
      "intent": "Understand which terminal session now needs recovery while staying in the same task context.",
      "action": "See that one terminal session inside the same task now needs recovery",
      "target": "notebook__task-terminal-workspace",
      "expectedFeedback": "用户可以辨认出是哪一条 terminal session 需要恢复，并知道其他 session 仍然属于同一个 task。",
      "note": "需要恢复的 session 解释必须留在 task 语境里，而不是退化成底层报错。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "clear-broken-session-and-keep-task-owned",
      "sceneId": "notebook-task",
      "intent": "End only the terminal session that needs recovery without releasing the task if other terminal work still exists.",
      "action": "End the terminal session that needs recovery and keep the task owned by the remaining terminal work",
      "target": "notebook__task-terminal-workspace",
      "expectedFeedback": "结束需要恢复的 session 后，其他 terminal session 继续保留，task 的 blocking truth 也同步更新。",
      "note": "清理问题 session 不能把整个 task 意外释放。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "start-fresh-terminal-session-after-recovery",
      "sceneId": "notebook-task",
      "intent": "Open a fresh terminal session after cleanup so the user can keep working in the same task.",
      "action": "Start a fresh terminal session after recovery",
      "target": "notebook__task-terminal-workspace",
      "expectedFeedback": "恢复和清理完成后，用户可以在同一个 task 里继续开新 terminal 工作。",
      "note": "恢复结束后的下一步应该是继续工作，而不是被迫跳出当前 task。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "end-recovered-terminal-session-and-return-to-agent-work",
      "sceneId": "notebook-task",
      "intent": "Finish the remaining terminal work and hand the task back to normal agent input.",
      "action": "End the recovered terminal session and return to agent work",
      "target": "notebook__task-terminal-status-strip",
      "expectedFeedback": "当最后的 terminal work 结束后，Conversation 输入重新回到可用状态。",
      "note": "恢复故事的收束点仍然是任务被正确释放。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for notebook terminal re-entry, fail-closed truth recovery, reconnection, and same-task recovery cleanup.
