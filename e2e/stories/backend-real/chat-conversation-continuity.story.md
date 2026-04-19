---
{
  "storyId": "chat-conversation-continuity",
  "title": "Chat conversation continuity",
  "actor": "project member",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects/{projectId}/chat",
  "goal": "项目成员在刷新后继续同一个对话时，chat session 会保留上下文，不需要重新解释之前的约定。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "Keycloak and provider API key are configured"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "chat": {
      "continuity": {
        "projectName": "Story Chat Continuity",
        "chatTitle": "story-chat-continuity",
        "rememberToken": "CHAT_CONTINUITY_OK",
        "rememberPrompt": "Remember this token for our session: CHAT_CONTINUITY_OK. Briefly confirm that you will remember it for later.",
        "recallPrompt": "After refresh, what token did I ask you to remember earlier? Reply with exactly the token and nothing else."
      }
    }
  },
  "narrative": "成员视角的 chat 主故事不是验证 runner 细节，而是确认一次真实对话在刷新后仍然连续，避免用户重新建立上下文。",
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
      "stepId": "open-chat",
      "sceneId": "project-chat",
      "intent": "Open the chat work surface as a project member.",
      "action": "Open project chat",
      "target": "chat__composer",
      "expectedFeedback": "项目成员看到可发送消息的 chat 工作面",
      "note": "项目成员看到可发送消息的 chat 工作面",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "remember-conversation",
      "sceneId": "project-chat",
      "intent": "Ask the assistant to remember a token in the current conversation.",
      "action": "Send remember prompt",
      "target": "chat__send-btn",
      "expectedFeedback": "assistant 在当前对话里确认记住 token",
      "note": "assistant 在当前对话里确认记住 token",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reload-chat-session",
      "sceneId": "project-chat",
      "intent": "Reload the page and reopen the same chat session.",
      "action": "Reload chat session",
      "target": "chat__composer",
      "expectedFeedback": "刷新后仍能看到同一会话里的历史消息",
      "note": "刷新后仍能看到同一会话里的历史消息",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "recall-conversation",
      "sceneId": "project-chat",
      "intent": "Ask the assistant to recall the remembered token.",
      "action": "Recall remembered token",
      "target": "chat__send-btn",
      "expectedFeedback": "assistant 继续使用同一会话上下文并返回 token",
      "note": "assistant 继续使用同一会话上下文并返回 token",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "chat-conversation-continuity",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for member chat continuity.
