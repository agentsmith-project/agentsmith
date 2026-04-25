---
{
  "storyId": "provider-capacity-retry-error-ux",
  "title": "Provider capacity, retry, and error recovery UX",
  "actor": "project member",
  "family": "provider-capacity-recovery",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
  "goal": "当 provider 短时拥塞或返回不可恢复错误时，成员应在 Chat / Notebook 工作面立刻知道自己该稍后重试、切换可用 endpoint，还是请项目操作人员修复配置；自己的线程、task 和已输入内容不应该在报错时一起丢失。",
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
      "dependencyId": "upstream-provider",
      "kind": "integration",
      "required": true,
      "note": "provider capacity and error UX story needs a real upstream path that can surface retryable capacity failures and non-retryable provider errors."
    }
  ],
  "narrative": "Provider error UX 的主故事不是把 429、401 或 retry limit 原样抛给用户，而是在工作面里给出明确下一步，同时保住用户已经完成的工作。retryable 的 capacity / transient 错误应该让成员留在当前 thread 或 task 里稍后再试，或切到另一个可用 endpoint；non-retryable 的配置、认证或权限错误则必须明确告诉用户这不是盲目重试能解决的问题。无论哪一种，产品都不应该因为 upstream 抖动让用户丢掉自己的输入和上下文。",
  "scenes": [
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
      "stableMarkers": [
        "chat__main-pane",
        "chat__composer",
        "chat__composer-recovery",
        "chat__stream-status"
      ]
    },
    {
      "sceneId": "notebook-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}",
      "stableMarkers": [
        "notebook__task-header",
        "notebook__message-process-error",
        "notebook__conversation-input",
        "notebook__send-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "surface-retryable-provider-capacity-in-chat",
      "sceneId": "project-chat",
      "intent": "Hit a retryable provider failure from normal chat work.",
      "action": "Send a chat request while the selected provider is at capacity",
      "target": "chat__composer-recovery",
      "expectedFeedback": "成员在当前 chat 线程里立即看到“可以稍后重试或切换可用路径”的恢复指引，而不是只看到底层 provider 词汇或静默失败。",
      "note": "retryable 错误首先要保护的是用户的下一步判断能力。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "recover-the-same-chat-thread-after-capacity-clears",
      "sceneId": "project-chat",
      "intent": "Retry or switch endpoint without abandoning the thread.",
      "action": "Recover the same chat thread after provider capacity clears",
      "target": "chat__composer",
      "expectedFeedback": "成员可以继续同一条 chat thread，不需要新建 thread 才能恢复成功。",
      "note": "capacity recovery 的价值在于保住 thread continuity。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "surface-retryable-capacity-or-retry-limit-in-notebook",
      "sceneId": "notebook-task",
      "intent": "See a retryable notebook failure without losing the task context.",
      "action": "Send a notebook turn while the provider reports capacity pressure or retry exhaustion",
      "target": "notebook__message-process-error",
      "expectedFeedback": "notebook task 在原地告诉成员这是可重试的 provider capacity 问题，并保留已有 task 历史与当前工作上下文。",
      "note": "Notebook 不应把 retryable capacity 错误包装成任务已坏掉的终局。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "retry-the-same-notebook-task-after-capacity-recovers",
      "sceneId": "notebook-task",
      "intent": "Continue notebook work after the upstream recovers.",
      "action": "Retry the same notebook task after capacity recovers",
      "target": "notebook__send-btn",
      "expectedFeedback": "成员在同一个 notebook task 里重试并恢复成功，不需要重建 task 才能继续工作。",
      "note": "task continuity 对 notebook 来说和 thread continuity 一样重要。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "distinguish-non-retryable-provider-errors-from-retry-later-states",
      "sceneId": "project-chat",
      "intent": "Avoid teaching the user to keep retrying when the real problem is configuration or authorization.",
      "action": "See a non-retryable provider error from the same work surface",
      "target": "chat__composer-recovery",
      "expectedFeedback": "当错误属于认证、权限或配置问题时，产品明确告诉成员这不是“稍后再试”能解决的问题，并引导到 operator 修复或 endpoint 切换。",
      "note": "错误分类的 UX 价值，是避免把不可恢复错误伪装成 transient 抖动。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for retryable provider capacity UX, same-surface recovery, and clear separation from non-retryable provider errors.
