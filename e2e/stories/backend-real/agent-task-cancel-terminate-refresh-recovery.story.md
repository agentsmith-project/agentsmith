---
{
  "storyId": "agent-task-cancel-terminate-refresh-recovery",
  "title": "Agent Task cancel, terminate, and refresh recovery",
  "actor": "project member",
  "family": "agent-task-stop-recovery",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
  "goal": "项目成员在 agent-task 里叫停一条失控或过慢的运行时，应该先能 cancel，再在需要时升级为 terminate；刷新或重新进入同一 task 后，产品必须继续说真话，不让旧运行幽灵式复活，也不把成员卡死在不能恢复工作的假忙碌状态里。",
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
      "dependencyId": "agent-task-runtime",
      "kind": "service",
      "required": true,
      "note": "backend-real agent-task stop recovery story needs a live Agent Task runtime with authoritative stop state after refresh."
    }
  ],
  "narrative": "Agent Task 的 stop recovery 主故事不是某个 stop_mode 字段，而是成员在同一个 task 里安全止损并继续工作。用户先尝试 cancel 当前运行；如果 cancel 长时间收不住，应该能在当前 task 里升级为 terminate，而不是被迫刷新碰运气。刷新或重新进入后，产品必须持续暴露 authoritative 的 stopping / terminating truth，直到 backend 真正确认任务恢复可用；恢复之后，成员应该马上能在同一个 task 里继续下一轮工作。",
  "scenes": [
    {
      "sceneId": "agent-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__message-active-run-cancel",
        "agent-tasks__cancel-escalation-dialog",
        "agent-tasks__cancel-escalation-confirm",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "reenter-running-agent-task",
      "sceneId": "agent-task",
      "intent": "Return to the same Agent Task that is still actively running.",
      "action": "Re-enter the running Agent Task",
      "target": "agent-task__task-header",
      "expectedFeedback": "成员回到正在运行的 Agent Task，而不是另开一个 task 才能止损。",
      "note": "止损入口必须留在当前任务语境里。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "cancel-the-active-run-from-the-task-surface",
      "sceneId": "agent-task",
      "intent": "Stop the current run before it wastes more time or cost.",
      "action": "Cancel the active agent-task run",
      "target": "agent-tasks__message-active-run-cancel",
      "expectedFeedback": "产品立即接受 cancel，并把任务切到清晰的 stopping 状态，避免成员误发第二次请求。",
      "note": "用户要看到的是“正在停下”，不是按钮瞬间消失后的猜测。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "escalate-a-stuck-cancel-to-terminate",
      "sceneId": "agent-task",
      "intent": "Escalate only when cancel has not finished and the task is still occupied.",
      "action": "Upgrade the stop request from cancel to terminate",
      "target": "agent-tasks__cancel-escalation-confirm",
      "expectedFeedback": "如果 cancel 长时间没有收束，成员可以在同一个 task 内升级为 terminate，而不是刷新碰运气。",
      "note": "升级动作必须仍然服务于“保住同一个 task 的工作连续性”。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "refresh-the-task-while-stop-truth-is-still-settling",
      "sceneId": "agent-task",
      "intent": "Refresh or re-enter the task without losing authoritative stop state.",
      "action": "Refresh the task while stopping or terminating is still settling",
      "target": "agent-task__task-header",
      "expectedFeedback": "刷新或重新进入后，界面继续显示 authoritative 的 stopping / terminating truth，而不是把旧运行当成没发生过。",
      "note": "refresh 不能制造“看起来好了”的假恢复。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "recover-the-same-task-after-stop-settles",
      "sceneId": "agent-task",
      "intent": "Regain a usable task only after backend stop truth has really cleared.",
      "action": "Wait for the same task to recover after stop settles",
      "target": "agent-tasks__conversation-input",
      "expectedFeedback": "一旦 backend 确认真正停稳，Conversation 输入在同一个 task 里恢复可用，没有旧运行幽灵式复活，也没有永久 blocked。",
      "note": "恢复标准是任务重新可工作，而不是 stop 请求返回过 202。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "continue-the-next-turn-in-the-same-task",
      "sceneId": "agent-task",
      "intent": "Keep working after recovery without creating a replacement task.",
      "action": "Send the next agent-task turn in the recovered task",
      "target": "agent-tasks__send-btn",
      "expectedFeedback": "成员能在同一个 task 里继续下一轮工作，不需要新建 task 来逃避卡住的旧状态。",
      "note": "这一步证明 recovery 真正回到了工作流，而不是只回到可点击状态。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for agent-task cancel escalation, terminate recovery, and truthful task resync after refresh.
