---
{
  "storyId": "ai-runtime-failure-and-recovery",
  "title": "AI runtime failure and recovery",
  "actor": "project operator",
  "family": "ai-runtime-failure-and-recovery",
  "personas": [
    "project operator"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects/{projectId}/chat",
  "goal": "项目操作人员在 chat 里遇到 endpoint/model runtime 离线时，应该立刻看到明确的恢复动作；完成重新连接后，能在同一条对话链里再次成功。",
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
      "dependencyId": "chat-endpoint-runtime",
      "kind": "service",
      "required": true,
      "note": "backend-real recovery story needs a reconnectable chat endpoint/model runtime."
    }
  ],
  "runtimeData": {
    "aiRuntimeFailureRecovery": {
      "chatTitlePrefix": "Story Runtime Recovery",
      "offlinePrompt": "Show the operator that the runtime is still offline.",
      "recoveryPrompt": "Reply with only AI_RUNTIME_RECOVERY_OK after the runtime is reconnected.",
      "recoveryToken": "AI_RUNTIME_RECOVERY_OK"
    }
  },
  "narrative": "AI runtime 的恢复主故事不是随机报错，而是用户在工作面里明确知道下一步：先看到离线与重连提示，再完成重连，并在同一对话里验证恢复成功。",
  "scenes": [
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
      "stableMarkers": [
        "chat__composer"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-chat-runtime-recovery",
      "sceneId": "project-chat",
      "intent": "Open the project chat surface that depends on an endpoint/model runtime.",
      "action": "Open runtime-backed chat",
      "target": "chat__composer",
      "expectedFeedback": "项目操作人员进入可发送消息的 chat 工作面。",
      "note": "恢复故事必须从真实工作面开始，而不是从治理配置页开始。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "trigger-runtime-failure",
      "sceneId": "project-chat",
      "intent": "Send a message while the endpoint/model runtime is offline.",
      "action": "Trigger offline runtime failure",
      "target": "chat__send-btn",
      "expectedFeedback": "界面明确显示 managed Agent Runner 离线，而不是静默失败。",
      "note": "用户先看到故障，才能判断自己是否需要恢复动作。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "review-runtime-recovery",
      "sceneId": "project-chat",
      "intent": "Review the recovery guidance after the failure is visible.",
      "action": "Review recovery guidance",
      "target": "chat__composer",
      "expectedFeedback": "界面明确告诉用户先重新连接 runtime 再重试。",
      "note": "故障提示必须给出明确下一步，而不是只暴露状态词。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "retry-after-recovery",
      "sceneId": "project-chat",
      "intent": "Reconnect the runtime and retry in the same conversation.",
      "action": "Retry after reconnect",
      "target": "chat__send-btn",
      "expectedFeedback": "重新连接后，用户能在同一条 chat 里再次成功得到回复。",
      "note": "恢复闭环的关键是同一工作流恢复成功，而不是跳到别的页面。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for AI runtime failure visibility, recovery guidance, and successful retry in the same chat session.
