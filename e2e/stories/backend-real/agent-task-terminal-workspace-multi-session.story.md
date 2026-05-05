---
{
  "storyId": "agent-task-terminal-workspace-multi-session",
  "title": "Agent Task terminal workspace with multiple sessions",
  "actor": "project member",
  "family": "agent-task-terminal-workspace",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
  "goal": "项目成员回到已有 Agent Task 继续工作时，应该先从 Conversation 进入 Terminal workspace，在同一 task 下面创建多个 terminal sessions 并在 tabs 间切换；当 live terminal 仍存在时，任务删除必须继续被阻止，第四个 terminal 也不能以假 tab 的方式出现；即使刷新或重新进入 task 页，界面也必须按 backend list 和同一批 session id 恢复这些 live sessions 与任务仍被占用的真相；关闭一个 session 不能影响其他 session，直到最后一个 session 结束后才真正释放任务并恢复 agent 输入。",
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
      "dependencyId": "agent-task-terminal-runtime",
      "kind": "service",
      "required": true,
      "note": "backend-real terminal workspace story needs a live terminal session service behind Agent Tasks."
    }
  ],
  "narrative": "Agent Task terminal 的真实故事不再是一个 panel 的 show/hide，而是用户在同一个 Agent Task 里切换 Conversation 与 Terminal workspace；terminal workspace 允许同时保留多条 terminal session 来做不同的检查和修复，但这些 session 共享同一个 task workspace，所以用户必须清楚知道它们仍在占用当前任务。产品不应该允许 live terminal 存在时误删 task，也不应该在达到上限后制造一个假的第四个 tab；即使页面刷新或用户重新进入 task，界面也要按 backend list 和原来的 session id 讲真话，恢复 tabs 和 blocking 状态，直到最后一条 session 被结束，任务才真正释放回正常的 agent 输入流。",
  "scenes": [
    {
      "sceneId": "agent-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-task__task-header-mode-terminal",
        "agent-tasks__task-terminal-workspace",
        "agent-tasks__task-terminal-status-strip"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "return-to-agent-task",
      "sceneId": "agent-task",
      "intent": "Return to the existing Agent Task that still needs follow-up work.",
      "action": "Return to Agent Task",
      "target": "agent-task__task-header",
      "expectedFeedback": "用户回到已有 Agent Task，并且仍然处在可继续工作的主工作面。",
      "note": "multi-session terminal 的故事仍然要从真实任务面开始，而不是从技术状态页开始。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-terminal-workspace",
      "sceneId": "agent-task",
      "intent": "Open the terminal workspace from the task header when the user needs to work directly in the task environment.",
      "action": "Open terminal workspace",
      "target": "agent-task__task-header-terminal-create",
      "expectedFeedback": "用户能够从 Agent Task 直接进入 Terminal workspace，而不是离开任务另找工具。",
      "note": "terminal 是 task 内的工作模式，不是脱离 task 的旁路工具。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "wait-for-first-terminal-session",
      "sceneId": "agent-task",
      "intent": "Stay oriented while the first terminal session is still warming up.",
      "action": "Wait for the first terminal session to become usable",
      "target": "agent-tasks__task-terminal-workspace",
      "expectedFeedback": "界面明确告诉用户 terminal workspace 正在为当前 task 准备 terminal session，而不是让人误以为卡死。",
      "note": "等待态要服务 Terminal workspace 本身，而不是退回旧 panel 心智。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "create-second-terminal-session",
      "sceneId": "agent-task",
      "intent": "Create another terminal session for the same task without losing the first one.",
      "action": "Create a second terminal session in the same terminal workspace",
      "target": "agent-tasks__task-terminal-create",
      "expectedFeedback": "用户在 Terminal workspace 里继续创建第二条 terminal session，并且第一条 session 不会被挤掉。",
      "note": "首个 terminal 从 task header 打开；后续 session 管理都应该留在 Terminal workspace 里。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "create-third-terminal-session",
      "sceneId": "agent-task",
      "intent": "Use the same task workspace for a third terminal session when the work genuinely needs it.",
      "action": "Create a third terminal session without losing the first two",
      "target": "agent-tasks__task-terminal-create",
      "expectedFeedback": "用户能够在 Terminal workspace 里开到第三条 terminal session，并且前三条 session 仍然清晰可切换。",
      "note": "三条 session 是并行工作的上限，不应靠隐藏旧 session 来假装支持更多。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "keep-task-delete-blocked-while-live-terminal-sessions-exist",
      "sceneId": "agent-task",
      "intent": "Prevent the user from deleting the task while terminal sessions still occupy it.",
      "action": "Try to delete the task while live terminal sessions still exist",
      "target": "agent-task__task-header-actions",
      "expectedFeedback": "当 live terminal sessions 仍占用 task 时，删除入口继续明确阻止删除，而不是让用户先打开确认框再失败。",
      "note": "删除阻止是 task truth 的一部分，不是 terminal workspace 内部的小提示。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reject-phantom-fourth-terminal-session",
      "sceneId": "agent-task",
      "intent": "Show the terminal session limit honestly instead of creating a fourth placeholder tab that cannot work.",
      "action": "Attempt to create a fourth terminal session after reaching the session limit",
      "target": "agent-tasks__task-terminal-create",
      "expectedFeedback": "达到 session 上限后，产品明确告诉用户不能再创建第四条 terminal，而不是出现一个并不存在的第四个 tab。",
      "note": "会误导用户的 phantom tab 比直接告知上限更糟糕。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "switch-between-terminal-sessions",
      "sceneId": "agent-task",
      "intent": "Switch between terminal session tabs and keep both sessions understandable.",
      "action": "Switch between terminal session tabs",
      "target": "agent-tasks__task-terminal-workspace",
      "expectedFeedback": "用户可以在 Terminal workspace 内切换 tabs，并知道这些 sessions 共享同一个 task workspace，但各自保留独立的 terminal 状态。",
      "note": "tabs 代表 terminal session，不代表多个隔离工作区。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "return-to-conversation-while-terminal-stays-active",
      "sceneId": "agent-task",
      "intent": "Return to the Conversation view for context while terminal sessions are still active.",
      "action": "Switch back to Conversation while terminal sessions stay active",
      "target": "agent-task__task-header-mode-conversation",
      "expectedFeedback": "用户回到 Conversation 后，界面仍明确告诉他 task 还被 terminal sessions 占用、Terminal Workspace 只是退到后台，并且新的 agent run 仍然不能开始，直到他重新打开 Terminal Workspace 或结束这些 sessions。",
      "note": "Conversation-first 不代表 terminal workspace 退到后台后就自动释放任务。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reload-task-and-preserve-backend-session-ids",
      "sceneId": "agent-task",
      "intent": "Reload or re-enter the task page and trust the product to restore the same terminal truth from the backend instead of local optimistic state.",
      "action": "Reload the task page while live terminal sessions still exist",
      "target": "agent-tasks__task-terminal-status-strip",
      "expectedFeedback": "页面刷新或重新进入后，Conversation 仍然是一号主工作面，但界面必须按 backend list 恢复 live terminal sessions 的 blocking truth 和同一批 session id。如果其中一条同源 session 在刷新后需要恢复处理，前台也必须立刻切到 recovery-aware 的占用文案和重新打开 Terminal Workspace 的动作，而不是继续假装所有 sessions 都只是隐藏在后台。",
      "note": "terminal session 是否存在、哪些还在占用 task、哪些需要恢复，真相都来自 backend list，不来自单页临时状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reject-new-run-while-live-terminal-sessions-exist",
      "sceneId": "agent-task",
      "intent": "Confirm that the backend still rejects a new agent run while live terminal sessions continue to occupy the task.",
      "action": "Attempt to start a new agent run while live terminal sessions still exist",
      "target": "agent-tasks__conversation-input",
      "expectedFeedback": "就算用户刷新或重新进入 task，backend 仍然会用 409 拒绝新的 agent run，直到这些 live terminal sessions 被结束。",
      "note": "blocking truth 不能只靠前端禁用态，backend 也必须继续讲真话。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reopen-terminal-workspace-after-reload",
      "sceneId": "agent-task",
      "intent": "Re-enter the terminal workspace after a reload and recover the live session tabs that still belong to this task.",
      "action": "Open terminal workspace again after the task page reloads",
      "target": "agent-tasks__task-terminal-status-strip",
      "expectedFeedback": "用户重新打开 Terminal workspace 后，应该看到 backend 仍然持有的 live terminal session tabs，而不是被迫重新创建新的 terminal。",
      "note": "hydrate 要恢复的是 live sessions 和 blocking truth，不只是把某个按钮重新显示出来。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "end-one-terminal-session-without-disrupting-others",
      "sceneId": "agent-task",
      "intent": "End one terminal session while keeping another session alive for the same task.",
      "action": "End one terminal session without disrupting the remaining session",
      "target": "agent-tasks__task-terminal-workspace",
      "expectedFeedback": "结束一条 session 后，剩余 session 仍然保持可用，用户不需要把整个 terminal workspace 都关掉。",
      "note": "单个 session 的结束不应影响其他 tabs。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "end-last-terminal-session-and-resume-agent-work",
      "sceneId": "agent-task",
      "intent": "End the last remaining terminal session and return the task to normal agent work.",
      "action": "End the last terminal session and resume agent work",
      "target": "agent-tasks__task-terminal-status-strip",
      "expectedFeedback": "最后一条 terminal session 结束后，Conversation 输入恢复可用，用户可以继续正常的 agent 输入流。",
      "note": "真正释放 task 的条件是最后一条 terminal session 被结束。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for the agent-task terminal workspace with multiple sessions, tab switching, and task release only after the last session ends.
