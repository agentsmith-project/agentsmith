---
{
  "storyId": "notebook-terminal-truth-unavailable-retry",
  "title": "Notebook terminal truth must be retried before the task unlocks",
  "actor": "project member",
  "family": "notebook-terminal-workspace",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}",
  "goal": "当项目成员重新进入 notebook task 时，如果 terminal 真相暂时不可用，产品必须先 fail-closed：Conversation、运行和删除都继续锁定，直到用户在当前 task 里明确重试 terminal 状态检查，并在 backend terminal truth 恢复后立刻同步解锁。",
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
      "note": "backend-real notebook terminal truth story needs notebook task terminal status from the live backend."
    }
  ],
  "narrative": "Notebook terminal truth unavailable 的故事不是一个临时错误 toast，而是一个真实的任务门禁时刻。用户回到同一个 task 时，如果产品暂时无法确认 backend 是否仍持有 live terminal session，就必须先诚实地 fail-closed，不让新的 create、运行或删除偷偷通过；恢复入口应该集中在当前被阻塞的 task surface 上，用户明确重试一次 terminal 状态检查后，只要 backend terminal truth 回来并确认任务已释放，Conversation 和删除就应该立刻同步解锁。",
  "scenes": [
    {
      "sceneId": "notebook-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__task-terminal-truth-unavailable",
        "notebook__conversation-blocked-state",
        "notebook__task-header-delete"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "return-to-task-while-terminal-truth-is-unavailable",
      "sceneId": "notebook-task",
      "intent": "Return to the notebook task while backend terminal truth cannot be confirmed yet.",
      "action": "Return to the task while terminal session truth is temporarily unavailable",
      "target": "notebook__task-header",
      "expectedFeedback": "用户重新进入任务时，先看到 terminal 真相暂时不可用，而不是误以为任务已经空闲。",
      "note": "terminal truth 不可用时，产品必须先 fail-closed。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "keep-run-and-delete-fail-closed-while-terminal-truth-is-missing",
      "sceneId": "notebook-task",
      "intent": "Keep create, run, and delete blocked while terminal truth is still missing.",
      "action": "Stay in the blocked task while run and delete remain fail-closed",
      "target": "notebook__conversation-blocked-state",
      "expectedFeedback": "Conversation、运行和删除继续锁定，恢复入口集中在当前 blocker 上。",
      "note": "用户应在同一个 task surface 里理解为什么现在不能继续工作。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "retry-terminal-truth-check-from-blocked-task",
      "sceneId": "notebook-task",
      "intent": "Explicitly retry the terminal truth check from the blocked task surface.",
      "action": "Retry terminal status check from the blocked task",
      "target": "notebook__conversation-blocked-state",
      "expectedFeedback": "用户能在当前 task 里明确重试 terminal 状态检查，而不是等待一个看不见的后台修复。",
      "note": "重试动作必须是显式的、就地的。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "unlock-task-after-terminal-truth-recovers",
      "sceneId": "notebook-task",
      "intent": "Regain normal notebook work as soon as backend terminal truth confirms the task is free again.",
      "action": "Continue the same task after backend terminal truth recovers",
      "target": "notebook__task-header-delete",
      "expectedFeedback": "一旦 backend truth 恢复并确认没有 live terminal session，Conversation、terminal 入口和删除立即同步解锁。",
      "note": "恢复结果必须立刻反馈到前台可操作状态。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for notebook terminal truth-unavailable fail-closed behavior and explicit retry inside the same task.
