---
{
  "storyId": "members-invite-and-chat-privacy",
  "title": "Members invite to first usable access",
  "actor": "project owner / invitee member",
  "family": "members-onboarding",
  "personas": [
    "project owner",
    "invitee member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/join",
  "goal": "被邀请的成员接受邀请后，应该立刻成为可用成员，能进入项目并开始第一次使用；与此同时，别人的私人聊天内容不能泄露给他。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [
    {
      "dependencyId": "provider-api-key",
      "kind": "credential",
      "required": true,
      "note": "backend-real member onboarding story needs a runnable endpoint for first-use chat validation."
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
    "membersInviteFirstUse": {
      "privateProjectNamePrefix": "Story Member Access",
      "sharedRunnerProjectNamePrefix": "Story Shared Runner",
      "credentialNamePrefix": "Story Member Endpoint Credential",
      "endpointNamePrefix": "Story Member Endpoint",
      "ownerPrivateMessagePrefix": "OWNER_PRIVATE_MESSAGE",
      "sharedChatTitlePrefix": "story-shared-chat",
      "ownerTokenPrefix": "OWNER_CHAT",
      "memberTokenPrefix": "MEMBER_CHAT"
    }
  },
  "narrative": "成员加入主故事不是审批流程本身，而是从接受邀请到第一次真正可用：先进入项目，再开始聊天使用，同时确认私人会话不会串给别的成员。",
  "scenes": [
    {
      "sceneId": "join-invite",
      "route": "/en-US/join",
      "stableMarkers": [
        "join__accept-btn"
      ]
    },
    {
      "sceneId": "project-overview",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/overview",
      "stableMarkers": [
        "project-hub__page"
      ]
    },
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
      "stableMarkers": [
        "chat__surface"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "accept-invite",
      "sceneId": "join-invite",
      "intent": "Accept the project invite.",
      "action": "Accept invite",
      "target": "join__accept-btn",
      "expectedFeedback": "被邀请成员成功接受邀请并获得项目访问资格。",
      "note": "成员加入路径的关键是让接受邀请后的去向清晰、没有身份迷路。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-member-first-access",
      "sceneId": "project-overview",
      "intent": "Open the project as a newly joined member and verify first usable access.",
      "action": "Verify member first access",
      "target": "project-hub__page",
      "expectedFeedback": "新成员能进入项目并开始第一次使用，而不是只停留在已加入的抽象状态。",
      "note": "第一次可用应该落到真实项目工作面，不只是接口返回成功。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "start-first-chat-use",
      "sceneId": "project-chat",
      "intent": "Open the project chat surface as the first day-one use path.",
      "action": "Start first chat use",
      "target": "chat__surface",
      "expectedFeedback": "成员能进入 chat 工作面，开始第一次 agent 使用。",
      "note": "成员第一次可用路径最好是具体工作面，而不是只看治理页面。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-chat-privacy",
      "intent": "Confirm a newly joined member cannot see another member's private chat session content.",
      "action": "Verify chat privacy",
      "expectedFeedback": "成员只能看到自己的私人 chat 会话，不能看到别人的私人内容。",
      "note": "join 成功不应带来跨成员的会话泄漏。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-shared-runner-isolation",
      "intent": "Confirm a shared chat runner can be reused without leaking one member's session content to another.",
      "action": "Verify shared runner isolation",
      "expectedFeedback": "共享 runner pod 只复用算力，不复用成员的会话内容。",
      "note": "系统可以共享执行资源，但不能共享用户私有会话。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for invite-to-first-use member onboarding and chat privacy.
