---
{
  "storyId": "chat-agent-task-target-model-continuity",
  "title": "Chat endpoint and managed Agent Task runner continuity",
  "actor": "project member",
  "family": "ai-work-target-model",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
  "goal": "项目成员在同一个项目里使用 Chat 与 Agent Task 时，Chat 只呈现 endpoint/model 选择，Agent Task 只呈现托管 Agent Runner；用户不需要理解旧兼容多路径，仍然能把同一份项目上下文带着走。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible",
    "project has one ready chat endpoint/model and one managed Agent Task runner"
  ],
  "seedData": [
    "ws_default"
  ],
  "externalDependencies": [
    {
      "dependencyId": "provider-api-key",
      "kind": "credential",
      "required": true,
      "note": "backend-real target model story needs a valid upstream credential for the project endpoint."
    },
    {
      "dependencyId": "managed-agent-task-runner",
      "kind": "service",
      "required": true,
      "note": "Agent Task work is validated through the managed runner path, with no extra selector for users to resolve."
    }
  ],
  "narrative": "从成员视角看，AI 工作连续性的关键是 Chat 与 Agent Task 各自只有一个清晰心智：Chat 面向 endpoint/model，Agent Task 面向托管 Agent Runner。两个入口都继续同一个项目上下文和治理真相，不把协议或 runner 差异暴露成用户要选择的产品路径。",
  "scenes": [
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
      "stableMarkers": [
        "chat__main-pane",
        "chat__execution-target-trigger",
        "chat__composer"
      ]
    },
    {
      "sceneId": "project-agent-runners",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-runners",
      "stableMarkers": [
        "agent-runners__table",
        "agent-runners__create-btn"
      ]
    },
    {
      "sceneId": "agent-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-task__task-header-meta",
        "agent-tasks__conversation-input",
        "agent-tasks__send-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "work-through-chat-endpoint-model",
      "sceneId": "project-chat",
      "intent": "Use the normal project chat surface through endpoint/model selection.",
      "action": "Send a message through the selected chat endpoint/model",
      "target": "chat__composer",
      "expectedFeedback": "成员在 Chat 工作面里直接得到回复，界面只呈现 endpoint/model 语义，不暴露旧兼容路径。",
      "note": "Chat 的目标模型是 endpoint/model-only。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "keep-chat-work-on-the-same-project-context",
      "sceneId": "project-chat",
      "intent": "Continue chat work without switching to a compatibility path.",
      "action": "Send the next chat message in the same project context",
      "target": "chat__execution-target-trigger",
      "expectedFeedback": "成员仍然留在同一个项目 Chat 语境里，看到的是 endpoint/model truth，而不是旧 path 切换器。",
      "note": "连续性来自项目上下文，而不是旧兼容矩阵。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "prepare-managed-agent-task-runner",
      "sceneId": "project-agent-runners",
      "intent": "Confirm the project has a managed Agent Task runner ready.",
      "action": "Review the managed Agent Runner",
      "target": "agent-runners__table",
      "expectedFeedback": "项目的托管 Agent Runner 可见且可用于 Agent Task，不出现 legacy runner 兼容路径。",
      "note": "Agent Task 的目标模型是 managed runner-only。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "complete-managed-agent-task",
      "sceneId": "agent-task",
      "intent": "Use Agent Task through the managed runner and complete one real task.",
      "action": "Run a managed Agent Task",
      "target": "agent-task__task-header-meta",
      "expectedFeedback": "成员完成 Agent Task，并能看到 task 由托管 Agent Runner 承接，而不是 legacy path。",
      "note": "Agent Task 必须跑通真实任务，不是只创建空壳 task。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "continue-managed-agent-task-work",
      "sceneId": "agent-task",
      "intent": "Continue Agent Task work in the same project.",
      "action": "Send the next Agent Task turn",
      "target": "agent-tasks__conversation-input",
      "expectedFeedback": "成员在同一个项目里继续 Agent Task，不需要选择另一套 runner path 才能继续。",
      "note": "managed-only 不应退化成多路径选择题。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "keep-project-truth-consistent-across-chat-and-agent-task",
      "sceneId": "agent-task",
      "intent": "See that Chat and Agent Task still feel like one project-scoped work system.",
      "action": "Confirm project work stays continuous across Chat endpoint/model and managed Agent Task runner",
      "target": "agent-task__task-header",
      "expectedFeedback": "Chat 与 Agent Task 都继续同一个项目上下文和可追踪工作真相，而不是漂成多套兼容入口。",
      "note": "目标模型的用户价值，是统一项目工作而不是暴露技术路径。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for the Chat endpoint/model-only and managed Agent Task runner-only target model.
