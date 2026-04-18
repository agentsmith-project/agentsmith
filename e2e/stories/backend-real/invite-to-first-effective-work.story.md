---
{
  "storyId": "invite-to-first-effective-work",
  "title": "Invite to first effective work",
  "actor": "project owner / invitee member",
  "family": "invite-first-effective-work",
  "personas": [
    "project owner",
    "invitee member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/join",
  "goal": "被邀请成员先看到公开 invite 真相并理解被邀请的 workspace 和 project；如果已经登录，join 页应直接接受邀请并落到被邀请项目的 overview；如果尚未登录，join 页应先保留 pending invite，并直接进入被邀请 workspace 的登录入口，登录后完成 accept，再落到 overview 并开始第一次有效工作。",
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
      "note": "The first effective work path uses a runnable project chat endpoint."
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
    "inviteToFirstEffectiveWork": {
      "privateProjectNamePrefix": "Story Invite First Work",
      "sharedRunnerProjectNamePrefix": "Story Shared Runner",
      "credentialNamePrefix": "Story Invite Endpoint Credential",
      "endpointNamePrefix": "Story Invite Endpoint",
      "ownerPrivateMessagePrefix": "OWNER_PRIVATE_MESSAGE",
      "sharedChatTitlePrefix": "story-shared-chat",
      "ownerTokenPrefix": "OWNER_CHAT",
      "memberTokenPrefix": "MEMBER_CHAT"
    }
  },
  "narrative": "被邀请成员的 first-use 先是看清 invite 对应的 workspace 和 project；如果已经登录，join 页会直接接受邀请并进入项目 overview；如果尚未登录，则先把 invite 保存在手边，直接进入被邀请 workspace 的专属登录入口，登录后再完成 accept，随后直接落到 overview，再开始第一个实际工作面。",
  "scenes": [
    {
      "sceneId": "join-invite",
      "route": "/en-US/join",
      "stableMarkers": [
        "join__invite-card",
        "join__invite-workspace",
        "join__invite-project",
        "join__continue-btn"
      ]
    },
    {
      "sceneId": "invited-workspace-login",
      "route": "/en-US/workspaces/{workspaceId}/login",
      "stableMarkers": [
        "workspace-login__heading",
        "workspace-login__keycloak-btn"
      ]
    },
    {
      "sceneId": "project-overview",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/overview",
      "stableMarkers": [
        "project-overview__page",
        "project-overview__primary-cta"
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
      "stepId": "inspect-invite-truth",
      "sceneId": "join-invite",
      "intent": "Read the public invite truth and understand which workspace and project this invite will enter.",
      "action": "Inspect invite truth",
      "target": "join__invite-card",
      "expectedFeedback": "成员可以直接看见邀请对应的 workspace 和 project，并理解接下来会进入哪个工作区的登录入口。",
      "note": "If the member is already authenticated, this same invite truth should auto-accept and continue to the same project overview without detouring through selection. If not authenticated, the join page should preserve the pending invite and continue to the invited workspace login.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "continue-to-invited-workspace-login",
      "sceneId": "join-invite",
      "intent": "Continue from the invite page directly into the invited workspace login entry while preserving the pending invite.",
      "action": "Continue to workspace sign in",
      "target": "join__continue-btn",
      "expectedFeedback": "未登录成员会直接进入被邀请 workspace 的登录入口，且 invite continuation 仍然保留。",
      "note": "Do not route through workspace selection. The invited workspace should be carried forward directly.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "complete-workspace-login-and-accept",
      "sceneId": "invited-workspace-login",
      "intent": "Finish workspace sign in and let the callback complete invite acceptance automatically.",
      "action": "Complete workspace sign in",
      "target": "workspace-login__keycloak-btn",
      "expectedFeedback": "成员登录后会自动完成 invite accept，并继续到被邀请项目的 overview。",
      "note": "The acceptance happens after authentication; the user should not need to re-select the workspace or re-open the invite.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "land-on-invited-project-overview",
      "sceneId": "project-overview",
      "intent": "Land directly on the invited project overview after the callback has completed.",
      "action": "Land on invited project overview",
      "target": "project-overview__page",
      "expectedFeedback": "成员完成登录后，直接落到被邀请项目的 overview，而不是先绕到项目列表里找项目。",
      "note": "The landing should be the invited project overview, not a generic workspace project list.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "start-first-chat-work",
      "sceneId": "project-chat",
      "intent": "Start the first concrete work path from overview into chat.",
      "action": "Start first chat work",
      "target": "project-overview__primary-cta",
      "expectedFeedback": "成员通过 overview 的下一步进入 chat，并开始第一次真实工作。",
      "note": "第一次有效工作应是具体工作面，而不是只停留在登录或治理状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-private-chat-boundary",
      "intent": "Confirm invite acceptance and first work do not leak another member's private chat history.",
      "action": "Verify private chat boundary",
      "expectedFeedback": "新成员开始第一次使用后，也不能看到项目中别人的私人 chat 内容。",
      "note": "first-use continuity 不应以牺牲私有会话边界为代价。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for invite acceptance through first effective project work.
