---
{
  "storyId": "internal-external-chat-notebook-proxy-matrix",
  "title": "Internal and external chat/notebook continuity through the universal proxy matrix",
  "actor": "project member",
  "family": "ai-work-matrix",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
  "goal": "项目成员在同一个项目里切换 internal / external 的 chat 与 notebook 工作时，四条主线都应通过统一的项目级 AI 入口稳定可用；用户不需要理解底层协议、provider 差异或哪一路经过 llm-universal-proxy，仍然能把同一份项目上下文带着走。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible",
    "project has one ready internal AI path and one ready external AI path for chat and notebook"
  ],
  "seedData": [
    "ws_default"
  ],
  "externalDependencies": [
    {
      "dependencyId": "llm-universal-proxy",
      "kind": "service",
      "required": true,
      "note": "backend-real AI matrix story depends on llm-universal-proxy carrying the supported protocol matrix without leaking protocol details into the product surface."
    },
    {
      "dependencyId": "internal-agent-runtime",
      "kind": "service",
      "required": true,
      "note": "the internal half of the matrix needs a live internal runner path for chat and notebook."
    },
    {
      "dependencyId": "provider-api-key",
      "kind": "credential",
      "required": true,
      "note": "the external half of the matrix needs a valid upstream credential."
    }
  ],
  "narrative": "从成员视角看，AI matrix 的关键不是 openai chat、responses 还是 anthropic messages，而是“这个项目里承诺给我的 internal / external chat 和 notebook 都真的能用”。只要项目把这些路径呈现为可选工作方式，产品就应该通过统一入口承接它们，让 internal chat、external chat、internal notebook、external notebook 四条主线都能继续同一个项目上下文，而不是把协议细节泄露给用户自己判断。",
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
      "sceneId": "notebook-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__task-header-agent-mode",
        "notebook__conversation-input",
        "notebook__send-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "work-through-the-external-chat-path",
      "sceneId": "project-chat",
      "intent": "Use the external chat path from the normal project chat surface.",
      "action": "Send a message through the external chat path",
      "target": "chat__composer",
      "expectedFeedback": "成员在 chat 工作面里直接得到 external chat 回复，不需要理解底层走的是哪一种协议。",
      "note": "external chat 对成员来说应该只是“这个项目里的一条可用工作路径”。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "switch-to-the-internal-chat-path-without-leaving-chat-work",
      "sceneId": "project-chat",
      "intent": "Change to the internal chat path while staying in the same chat workflow.",
      "action": "Switch chat to the internal path and send the next message",
      "target": "chat__execution-target-trigger",
      "expectedFeedback": "成员仍然留在同一个项目 chat 语境里完成 internal chat，而不是跳到另一个产品或配置流程。",
      "note": "切换 internal / external 不能打断当前工作面的连续性。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "complete-an-external-notebook-task",
      "sceneId": "notebook-task",
      "intent": "Use notebook with the external path and complete one real task.",
      "action": "Run an external notebook task",
      "target": "notebook__task-header-agent-mode",
      "expectedFeedback": "成员在 notebook 里完成 external task，并能明确看到当前 task 属于 external 路径。",
      "note": "notebook 的 external path 必须是可完成工作的真实路径，不是只创建空壳 task。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "complete-an-internal-notebook-task",
      "sceneId": "notebook-task",
      "intent": "Use notebook with the internal path and complete one real task in the same project.",
      "action": "Run an internal notebook task",
      "target": "notebook__conversation-input",
      "expectedFeedback": "成员在同一个项目里也能完成 internal notebook task，而不需要离开 notebook 主工作流。",
      "note": "internal notebook 的存在感应该是“另一条可用路径”，不是“另一套产品”。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "keep-project-truth-consistent-across-all-four-paths",
      "sceneId": "notebook-task",
      "intent": "See that switching among the four paths still feels like one project-scoped work system.",
      "action": "Confirm project work stays continuous across internal and external chat/notebook paths",
      "target": "notebook__task-header",
      "expectedFeedback": "chat internal、chat external、notebook internal、notebook external 都继续同一个项目上下文和可追踪工作真相，而不是各自漂成四套孤岛。",
      "note": "matrix coverage 的用户价值，是统一项目工作而不是统一技术名词。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for the internal/external chat and notebook matrix carried through llm-universal-proxy without leaking protocol detail to the user.
