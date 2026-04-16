---
{
  "storyId": "project-surface-handoff-continuity",
  "title": "Project surface handoff continuity",
  "actor": "project member",
  "lane": "backend-real",
  "family": "project-surface-handoff-continuity",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/overview",
  "goal": "项目成员从 overview 连续切到 chat、notebook、files，再返回 overview 时，工作上下文仍然连续，不需要重新解释自己正在做什么。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [],
  "preconditions": [
    "backend-real stack is ready",
    "project member has access to the project surfaces"
  ],
  "seedData": [
    "ws_default"
  ],
  "narrative": "普通成员的日常工作心智不是一个个页面，而是先看 overview，再连续切换到 chat、notebook 和 files，最后回到 overview 继续往下做事；每次切换都应保留同一个 project context。",
  "scenes": [
    {
      "sceneId": "project-overview",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/overview",
      "stableMarkers": [
        "project-hub__page",
        "project-workbench__heading"
      ]
    },
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
      "stableMarkers": [
        "chat__main-pane",
        "project-workbench__heading"
      ]
    },
    {
      "sceneId": "project-notebook",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook",
      "stableMarkers": [
        "notebook__task-list",
        "project-workbench__heading"
      ]
    },
    {
      "sceneId": "project-files",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__workspace-surface",
        "files__library-list"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-project-overview",
      "sceneId": "project-overview",
      "intent": "Open the project overview as the daily handoff hub.",
      "action": "Open project overview",
      "target": "project-hub__page",
      "expectedFeedback": "成员看到同一个 project context 的 overview 工作面，知道接下来可以继续往 chat、notebook 或 files 去。",
      "note": "overview 是日常工作中心，不是单独的 landing page。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "handoff-to-chat",
      "sceneId": "project-chat",
      "intent": "Move from overview into chat without losing project context.",
      "action": "Switch to chat",
      "target": "sidebar__nav-item--chat",
      "expectedFeedback": "切到 chat 后仍然是同一个项目壳层，用户不用重新确认自己在哪个项目。",
      "note": "从 overview 到 chat 是同一 project 的连续 handoff。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "handoff-to-notebook",
      "sceneId": "project-notebook",
      "intent": "Continue from chat into notebook while keeping the same project work context.",
      "action": "Switch to notebook",
      "target": "sidebar__nav-item--notebook",
      "expectedFeedback": "切到 notebook 后仍然保留同一个 project context，能继续刚才的工作心智。",
      "note": "notebook 是同一项目里继续工作，不是跳到另一套陌生系统。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "handoff-to-files",
      "sceneId": "project-files",
      "intent": "Continue from notebook into files without breaking the project-level workflow.",
      "action": "Switch to files",
      "target": "sidebar__nav-item--files",
      "expectedFeedback": "切到 files 后仍然是同一个项目上下文，文件 surface 和前面的工作面衔接一致。",
      "note": "files 不是单独跳出项目的外部页面，而是项目工作流的一部分。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "return-to-overview",
      "sceneId": "project-overview",
      "intent": "Return to overview and confirm the project handoff loop is still continuous.",
      "action": "Return to overview",
      "target": "sidebar__nav-item--overview",
      "expectedFeedback": "回到 overview 时仍处于同一个项目工作上下文，前面的切换没有丢掉上下文。",
      "note": "返回 overview 后可以继续下一轮工作，而不是像重新进门一样。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for project surface handoff continuity.
