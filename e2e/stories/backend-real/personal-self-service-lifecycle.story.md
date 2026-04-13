---
{
  "storyId": "personal-self-service-lifecycle",
  "title": "Personal self-service lifecycle",
  "actor": "workspace member / project member",
  "family": "personal-self-service",
  "personas": [
    "workspace member",
    "project member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/user/profile",
  "goal": "成员先把自己的个人身份、访问能力和 personal context 配置到可用状态，再回到项目继续工作时，应该能一眼确认这些个人设置已经 ready，而不是在个人资料、连接、凭据和上下文之间来回排障。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [
    {
      "dependencyId": "local-anthropic-compatible-upstream",
      "kind": "service",
      "required": true,
      "note": "backend-real self-service lifecycle uses a local deterministic upstream to keep endpoint consumption assertions stable."
    }
  ],
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible",
    "Keycloak integration users are available"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "personalSelfServiceLifecycle": {
      "projectNamePrefix": "Story Self Service Access",
      "endpointNamePrefix": "Story Self Service Endpoint",
      "credentialNamePrefix": "Story Self Service Credential",
      "profileDisplayName": "Story Self Service Member",
      "profileBio": "Owns personal access setup and keeps project access ready for daily use.",
      "apiKeyLabelPrefix": "Story Self Service Key",
      "apiKeyTtlDays": "7",
      "connectionDisplayNamePrefix": "Story Personal Connection",
      "connectionCustomDomainSuffix": "story-personal-self-service.example.com",
      "connectionToken": "tok-story-personal-self-service",
      "connectionNote": "Personal custom connection for the self-service lifecycle story.",
      "personalContextKey": "personal.preferences.response_mode",
      "workspacePersonalContextValue": "workspace-default-brief",
      "projectPersonalContextValue": "project-override-detailed",
      "model": "story-self-service-model",
      "expectedReplyText": "PERSONAL_SELF_SERVICE_READY"
    }
  },
  "narrative": "个人自助主故事不是分别证明 profile、API key、personal connections 和 personal context 页面存在，而是验证成员能把这些个人设置整理到 ready 状态，然后顺着项目 access guide 继续工作，并明确感知 workspace 默认与 project override 已经生效。",
  "scenes": [
    {
      "sceneId": "user-profile",
      "route": "/en-US/user/profile?workspace={workspaceId}&project={projectId}",
      "stableMarkers": [
        "profile__form",
        "profile__save-btn"
      ]
    },
    {
      "sceneId": "personal-connections",
      "route": "/en-US/user/third-party-accounts",
      "stableMarkers": [
        "third-party-accounts__create-btn",
        "third-party-accounts__list-section"
      ]
    },
    {
      "sceneId": "user-api-keys",
      "route": "/en-US/user/api-keys",
      "stableMarkers": [
        "api-keys__create-btn",
        "api-keys__list-section"
      ]
    },
    {
      "sceneId": "workspace-personal-context",
      "route": "/en-US/workspaces/{workspaceId}/context",
      "stableMarkers": [
        "context-store__list-card"
      ]
    },
    {
      "sceneId": "project-personal-context",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/my-context",
      "stableMarkers": [
        "context-store__list-card"
      ]
    },
    {
      "sceneId": "project-use-guide",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/use-guide",
      "stableMarkers": [
        "use-guide__page"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "update-personal-profile",
      "sceneId": "user-profile",
      "intent": "Update personal identity details so future project work shows the member in a ready state.",
      "action": "Update personal profile",
      "target": "profile__save-btn",
      "expectedFeedback": "个人资料保存后会稳定持久化，成员重新进入时能看到自己的最新身份信息。",
      "note": "用户自助第一步应该先把自己的身份信息整理到可信状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "create-personal-connection",
      "sceneId": "personal-connections",
      "intent": "Create a personal connection that the member can later reuse as part of personal access setup.",
      "action": "Create personal connection",
      "target": "third-party-accounts__create-btn",
      "expectedFeedback": "个人连接保存成功并留在清单里，成员能确认自己的连接已经进入可用状态。",
      "note": "连接配置应该是用户可以自己完成的访问准备，而不是只留给治理面。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "create-personal-api-key",
      "sceneId": "user-api-keys",
      "intent": "Create a personal API key for project access.",
      "action": "Create personal API key",
      "target": "api-keys__create-btn",
      "expectedFeedback": "成员成功创建自己的访问 key，并能立即拿来进入项目访问主链。",
      "note": "个人访问入口应该由用户自助建立，而不是依赖额外运维交接。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-workspace-personal-context",
      "sceneId": "workspace-personal-context",
      "intent": "Open workspace personal context to set reusable private defaults for future project work.",
      "action": "Open workspace personal context",
      "target": "user-menu__workspace-personal-context",
      "expectedFeedback": "成员进入 My Workspace Context，并看到这些默认值会在当前工作区内持续生效。",
      "note": "workspace personal context 应该讲清楚它是跨项目可复用的私有默认值。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "save-workspace-personal-context",
      "sceneId": "workspace-personal-context",
      "intent": "Save a workspace-level private default for the member.",
      "action": "Save workspace personal context",
      "target": "context-store__save",
      "expectedFeedback": "workspace personal context 保存成功，成员知道自己已经设置了工作区默认值。",
      "note": "用户需要把私有默认值配置到 ready 状态，而不是只看到空白上下文页。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-project-personal-context",
      "sceneId": "project-personal-context",
      "intent": "Open project personal context to define a project-specific override.",
      "action": "Open project personal context",
      "target": "user-menu__project-personal-context",
      "expectedFeedback": "成员进入 My Project Context，并看到这里的条目只影响当前项目。",
      "note": "project personal context 应该明确表达它会覆盖当前项目，但不会回写 workspace 默认值。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "save-project-personal-context",
      "sceneId": "project-personal-context",
      "intent": "Save a project-specific override for the same working preference.",
      "action": "Save project personal context",
      "target": "context-store__save",
      "expectedFeedback": "project personal context 保存成功，成员知道当前项目已经有自己的 override。",
      "note": "用户需要感知 workspace 默认与 project override 的连续关系，而不是把两页当成无关设置。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "review-project-access-guide",
      "sceneId": "project-use-guide",
      "intent": "Return to the project access guide after personal setup is complete.",
      "action": "Review project access guide",
      "target": "use-guide__page",
      "expectedFeedback": "成员回到项目 access guide 后，能看到 access readiness 和 personal context readiness 都已经准备好。",
      "note": "自助配置的完成标准之一，是能顺着 access guide 继续工作。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-personal-access-ready",
      "sceneId": "project-use-guide",
      "intent": "Use the personal API key against the project endpoint and confirm access is truly ready.",
      "action": "Verify personal access ready",
      "target": "use-guide__status-context",
      "expectedFeedback": "成员用自己的访问 key 成功调用项目 endpoint，并从页面上确认 workspace/project personal context 都已 ready。",
      "note": "最终标准不是页面保存成功，而是用户能立即完成第一次真实访问，并知道这些个人设置已经生效。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---

Canonical backend-real story for the personal self-service lifecycle.
