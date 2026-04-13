---
{
  "storyId": "notebook-terminal-day-to-day-and-recovery",
  "title": "Notebook terminal day-to-day and recovery",
  "actor": "project member",
  "family": "notebook-terminal-day-to-day",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/login",
  "goal": "项目成员回到已有 notebook 任务继续工作时，terminal 应该在 runner 预热期间保持清晰可理解；用户可以先把终端隐藏但保留会话、再重新显示，只有结束会话后才真正释放任务；如果这次打开失败，界面必须明确告诉用户下一步，并让他在同一条任务流里恢复成功。",
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
      "note": "backend-real terminal story needs a live terminal session service behind notebook tasks."
    }
  ],
  "narrative": "Notebook terminal 的日常故事不是几个离散按钮状态，而是用户回来继续处理任务时，先清楚地知道自己仍在等待什么，再能把已打开的终端暂时收起而不丢失会话，随后重新显示或真正结束会话；如果终端打开失败，界面必须给出明确的恢复动作，并让用户在同一任务面里继续工作。",
  "scenes": [
    {
      "sceneId": "notebook-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__task-header-terminal",
        "notebook__task-terminal-notice"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "return-to-notebook-task",
      "sceneId": "notebook-task",
      "intent": "Return to the existing notebook task that still needs follow-up work.",
      "action": "Return to notebook task",
      "target": "notebook__task-header",
      "expectedFeedback": "用户回到已有 notebook 任务，并且仍然处在可继续工作的主工作面。",
      "note": "day-2 terminal 故事必须从真实任务面开始，而不是从技术状态页开始。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-terminal-for-follow-up-work",
      "sceneId": "notebook-task",
      "intent": "Open terminal to continue inspecting or fixing the current task by hand.",
      "action": "Open terminal for follow-up work",
      "target": "notebook__task-header-terminal",
      "expectedFeedback": "用户能够从 notebook task 直接打开 terminal，继续当前任务。",
      "note": "打开 terminal 是继续工作，不是离开当前任务另找工具。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "stay-oriented-during-runner-warmup",
      "sceneId": "notebook-task",
      "intent": "Stay oriented while the runner is still warming up before the terminal can open.",
      "action": "Review runner warmup guidance",
      "target": "notebook__task-terminal",
      "expectedFeedback": "界面明确告诉用户 terminal 正在等待 runner 准备，而不是让人误以为已经失败或卡死。",
      "note": "等待态必须服务主任务，而不是把注意力拖到技术细节上。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "hide-terminal-without-ending-session",
      "sceneId": "notebook-task",
      "intent": "Temporarily hide the terminal without giving up the active terminal session.",
      "action": "Hide terminal without ending the session",
      "target": "notebook__task-header-terminal",
      "expectedFeedback": "用户可以暂时收起 terminal，但界面仍明确告诉他 terminal 会话还在占用当前任务，需要先重新显示或结束会话，才能开始新的 agent run。",
      "note": "隐藏只是先收起工作面，不应被误解成已经释放 terminal 会话。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "show-hidden-terminal-session",
      "sceneId": "notebook-task",
      "intent": "Bring the still-active terminal session back without creating a new session.",
      "action": "Show the hidden terminal session again",
      "target": "notebook__task-terminal-notice",
      "expectedFeedback": "用户可以从隐藏提示中重新显示 terminal，继续刚才那条会话，而不是重新创建一个新终端。",
      "note": "重新显示是回到同一条 terminal 会话，而不是重新开始。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "end-terminal-session-before-new-run",
      "sceneId": "notebook-task",
      "intent": "End the terminal session when the user is done with it so the task can accept a new agent run.",
      "action": "End terminal session from the task header",
      "target": "notebook__task-header-terminal-close",
      "expectedFeedback": "结束 terminal 会话后，任务重新释放出来，用户可以回到正常的 agent 输入流，而不是继续被隐藏的 terminal 会话占用。",
      "note": "真正释放任务的是结束会话，而不是隐藏 terminal。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "see-clear-terminal-recovery-guidance",
      "sceneId": "notebook-task",
      "intent": "See a clear next step when terminal creation is rejected.",
      "action": "Review terminal recovery guidance",
      "target": "notebook__task-terminal",
      "expectedFeedback": "terminal 失败时，界面会明确告诉用户先结束当前终端会话，再从任务头部重新打开重试。",
      "note": "失败提示必须给下一步，不应只暴露错误原因。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "recover-terminal-after-guidance",
      "sceneId": "notebook-task",
      "intent": "Retry after following the guidance and get back to a usable terminal in the same task.",
      "action": "Recover terminal after guidance",
      "target": "notebook__task-terminal",
      "expectedFeedback": "用户按照恢复提示重新打开 terminal 后，能在同一条 notebook task 流里恢复到可用状态。",
      "note": "恢复闭环的标准是在同一任务里重新变得可用，而不是跳去别的入口。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for day-to-day notebook terminal use, runner warmup clarity, and explicit recovery in the same task.
