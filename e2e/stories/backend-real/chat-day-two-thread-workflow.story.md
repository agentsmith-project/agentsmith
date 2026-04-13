---
{
  "storyId": "chat-day-two-thread-workflow",
  "title": "Chat day-two thread workflow",
  "actor": "project member",
  "family": "chat-day-two",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects/{projectId}/chat",
  "goal": "项目成员第二天回到 chat 时，能保留有价值的线程、给它重新命名、删除无用线程，并继续在保留线程上工作，而不是从头整理上下文。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [
    {
      "dependencyId": "local-openai-compatible-upstream",
      "kind": "service",
      "required": true,
      "note": "backend-real chat day-two story uses a local deterministic upstream to keep thread lifecycle assertions stable."
    }
  ],
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "chatDayTwoWorkflow": {
      "projectNamePrefix": "Story Chat Day Two",
      "upstreamReplyText": "Story chat day-two reply",
      "firstThreadPrompt": "Summarize the active customer thread so I can continue it tomorrow.",
      "secondThreadPrompt": "Create a scratch reply draft that I may delete later.",
      "resumeThreadPrompt": "Continue the kept thread after cleanup with one short follow-up.",
      "renamedThreadPrefix": "Customer follow-up"
    }
  },
  "narrative": "Chat 的 day-two 主故事不是单纯证明 streaming 能工作，而是验证成员第二天回来时，能继续整理线程，把有价值的对话留下来，把临时线程清掉，然后继续在正确的线程里工作。",
  "scenes": [
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/ws_default/projects/{projectId}/chat",
      "stableMarkers": [
        "chat__main-pane",
        "chat__thread-item"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-chat-day-two",
      "sceneId": "project-chat",
      "intent": "Open chat and create the first thread that will be kept for future work.",
      "action": "Open day-two chat",
      "target": "chat__main-pane",
      "expectedFeedback": "成员进入 chat 工作面，并开始保留的主线程。",
      "note": "day-two 的起点应该是回到已有工作面，而不是重新摸索入口。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "create-follow-up-thread",
      "sceneId": "project-chat",
      "intent": "Create a second temporary thread for scratch work.",
      "action": "Create follow-up thread",
      "target": "chat__new-thread-btn",
      "expectedFeedback": "成员能为临时讨论单独开线程，而不污染主要工作线程。",
      "note": "线程分流是 chat 日常整理工作的核心动作。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "rename-keep-thread",
      "sceneId": "project-chat",
      "intent": "Rename the thread worth keeping for future reference.",
      "action": "Rename kept thread",
      "target": "chat__thread-item",
      "expectedFeedback": "保留线程被改成清晰标题，便于之后再次打开。",
      "note": "第二天回来时，最关键的是让重要线程有可识别名字。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "delete-stale-thread",
      "sceneId": "project-chat",
      "intent": "Delete the temporary scratch thread that is no longer needed.",
      "action": "Delete stale thread",
      "target": "chat__delete-thread-confirm",
      "expectedFeedback": "临时线程被删除，线程列表只保留仍有价值的对话。",
      "note": "清理无用线程应该是低负担、不会误伤保留线程的动作。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "resume-kept-thread",
      "sceneId": "project-chat",
      "intent": "Return to the renamed thread and continue working in it.",
      "action": "Resume kept thread",
      "target": "chat__thread-item",
      "expectedFeedback": "成员回到保留线程后，可以继续发送下一条消息，而不用重新建线程。",
      "note": "day-two workflow 的完成标准，是用户能顺着保留线程继续工作。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for day-two chat thread lifecycle work.
