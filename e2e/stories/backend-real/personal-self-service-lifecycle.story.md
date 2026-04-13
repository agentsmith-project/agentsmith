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
  "goal": "成员把自己的个人身份和访问能力配置到可用状态后，应该能立即带着这些个人设置进入项目 access guide 并成功使用自己的访问入口，而不是在个人资料、连接和访问凭据之间来回排障。",
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
      "model": "story-self-service-model",
      "expectedReplyText": "PERSONAL_SELF_SERVICE_READY"
    }
  },
  "narrative": "个人自助主故事不是分别证明 profile、API key、personal connections 这些页面存在，而是验证成员能把自己的身份和访问能力整理到可用状态，然后带着这些自助配置进入项目并马上开始使用。",
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
      "stepId": "review-project-access-guide",
      "sceneId": "project-use-guide",
      "intent": "Review the project access guide after personal setup is complete.",
      "action": "Review project access guide",
      "target": "use-guide__page",
      "expectedFeedback": "成员能看到项目当前可用的 canonical access guide，并确认下一步访问方式。",
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
      "target": "use-guide__page",
      "expectedFeedback": "成员用自己的访问 key 成功调用项目 endpoint，说明个人身份和访问能力已经真正配置完成。",
      "note": "最终标准不是页面保存成功，而是用户能立即完成第一次真实访问。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---

Canonical backend-real story for the personal self-service lifecycle.
