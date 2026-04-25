---
{
  "storyId": "chat-stop-terminate-idempotent-state-resync",
  "title": "Chat stop, terminate, and idempotent state resync",
  "actor": "project member",
  "family": "chat-stop-recovery",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
  "goal": "项目成员在 chat 里叫停一条过长或失控的回复时，应该先能 stop，必要时再升级 terminate；不管刷新、重进线程还是重复发 terminate，产品都要把同一条会话 resync 到唯一真相，不留下 ghost streaming、重复 assistant 回复或永远 disabled 的输入框。",
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
      "dependencyId": "chat-streaming-runtime",
      "kind": "service",
      "required": true,
      "note": "backend-real chat stop recovery story needs a live streaming runtime with authoritative session truth after refresh."
    }
  ],
  "narrative": "Chat 的 stop recovery 主故事不是停在哪一条 API route，而是成员能在同一线程里安全打断一次失控回复，并继续保有这条线程。用户先发 stop；如果 stop 长时间不收敛，应该能升级 terminate。随后无论刷新、重新打开线程，还是再点一次 terminate，产品都必须 resync 到同一份会话真相：保留已经看到的部分回复，结束掉真正卡住的流，并在状态收束后把输入框还给用户继续工作。",
  "scenes": [
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
      "stableMarkers": [
        "chat__main-pane",
        "chat__thread-item",
        "chat__composer",
        "chat__stop-btn",
        "chat__stream-status",
        "chat__stop-escalation-dialog",
        "chat__stop-escalation-confirm"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-the-active-chat-thread",
      "sceneId": "project-chat",
      "intent": "Return to the same chat thread that is still generating a reply.",
      "action": "Open the active chat thread",
      "target": "chat__thread-item",
      "expectedFeedback": "成员回到原来的 chat thread，而不是靠新开线程来绕过卡住的回复。",
      "note": "stop recovery 的真相必须落在原线程连续性上。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "stop-the-active-stream-from-the-thread",
      "sceneId": "project-chat",
      "intent": "Interrupt the streaming reply before it keeps running.",
      "action": "Stop the active chat reply",
      "target": "chat__stop-btn",
      "expectedFeedback": "产品接受 stop 请求，并把线程切到清晰可见的 stopping 状态，而不是静默卡住。",
      "note": "用户需要一个可理解的“正在停下”时刻。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "escalate-to-terminate-if-stop-does-not-settle",
      "sceneId": "project-chat",
      "intent": "Terminate only when the chat still has not recovered after stop.",
      "action": "Escalate the stuck stop request to terminate",
      "target": "chat__stop-escalation-confirm",
      "expectedFeedback": "如果 stop 迟迟不收束，成员可以在同一线程里升级 terminate，不需要离开工作面寻找后台补救。",
      "note": "升级动作必须留在用户当下的对话语境里。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "refresh-and-reopen-the-same-thread-without-ghost-streaming",
      "sceneId": "project-chat",
      "intent": "Refresh or reopen the same thread and see one authoritative session state.",
      "action": "Refresh and reopen the same chat thread",
      "target": "chat__thread-item",
      "expectedFeedback": "刷新后，线程保留已看到的部分内容，并继续呈现 authoritative 的 stopped / terminating truth，而不是出现 ghost streaming 或重复回复。",
      "note": "refresh 后的 resync 应该保留用户已经获得的上下文。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "repeat-terminate-without-reopening-a-settled-stop-loop",
      "sceneId": "project-chat",
      "intent": "Treat a repeated terminate request as a no-op when the session is already finished.",
      "action": "Repeat terminate after the stuck stream has already been cleared",
      "target": "chat__stream-status",
      "expectedFeedback": "重复 terminate 不会把线程重新打回卡住状态，也不会制造新的错误循环；会话真相保持稳定。",
      "note": "idempotent 对用户的意义，是“我多点一次也不会把状态弄坏”。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "continue-working-in-the-same-thread-after-resync",
      "sceneId": "project-chat",
      "intent": "Send the next message after state resync completes.",
      "action": "Continue the same chat thread after stop recovery",
      "target": "chat__composer",
      "expectedFeedback": "状态收束后，成员可以在同一 thread 继续发送下一条消息，而不是被永久锁死或被迫新建 thread。",
      "note": "恢复闭环的终点是同一线程继续工作。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for chat stop escalation, refresh resync, and idempotent terminate truth.
