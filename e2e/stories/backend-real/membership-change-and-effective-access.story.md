---
{
  "storyId": "membership-change-and-effective-access",
  "title": "Project governance access model",
  "actor": "project owner / project admin / joined member",
  "family": "project-governance-access-model",
  "personas": [
    "project owner",
    "project admin",
    "joined member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects",
  "goal": "项目成员的邀请、接受邀请、升权、降权和移除都应该立即反映在 effective access 上，页面和 backend 都不能继续显示旧能力状态。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is available",
    "Keycloak integration users are available"
  ],
  "externalDependencies": [
    {
      "dependencyId": "integration-keycloak-users",
      "kind": "integration",
      "required": true,
      "note": "backend-real membership change story needs integration Keycloak users to exercise day-2 promotion and removal."
    }
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "membershipChange": {
      "projectNamePrefix": "Story Membership Effective Access",
      "memberDisplayName": "Integration Member",
      "memberEmail": "integration-member@example.com",
      "joinedMemberPermissions": [
        "project:endpoint:use",
        "project:agent:use",
        "project:terminal:use"
      ],
      "promotedMemberPermissions": [
        "project:endpoint:use",
        "project:agent:use",
        "project:terminal:use",
        "project:agent:manage",
        "project:agent:public",
        "project:audit:read",
        "project:governance:update",
        "project:membership:update",
        "project:admins:update",
        "project:files:update"
      ]
    }
  },
  "narrative": "成员心智上最重要的不是一个邀请成功，而是当他接受邀请并变成项目成员之后，自己能做什么要马上变；effective access drawer 也必须同步讲真话，并且默认成员语义要对齐真实的项目成员权限状态。",
  "scenes": [
    {
      "sceneId": "project-members",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/members",
      "stableMarkers": [
        "members__table",
        "member-detail__effective-access-summary"
      ]
    },
    {
      "sceneId": "project-settings",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/settings",
      "stableMarkers": [
        "settings__project-admins-section"
      ]
    },
    {
      "sceneId": "project-overview",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/overview",
      "stableMarkers": [
        "project-overview__page"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "issue-project-invite",
      "sceneId": "project-members",
      "intent": "Create and share a project invite as the entry point for the membership flow.",
      "action": "Issue project invite",
      "target": "members__invite-btn",
      "expectedFeedback": "项目 owner 能创建邀请链接，并把成员引导到正确的项目入口。",
      "note": "先把成员拉进来，再看 effective access 如何变化。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "accept-project-invite",
      "sceneId": "project-members",
      "intent": "Accept the project invite so the member can enter the project and receive initial access.",
      "action": "Accept project invite",
      "target": "member-detail__effective-access-summary",
      "expectedFeedback": "成员接受邀请后，默认立即显示 Project Members 的 member template permissions。",
      "note": "先确认成员首次进入项目后的 effective access 是真实生效的 member template，而不是空白或缓存残留。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-member-effective-access",
      "sceneId": "project-members",
      "intent": "Open the member drawer after invite acceptance and verify the first effective access truth.",
      "action": "Open member effective access",
      "target": "member-detail__effective-access-summary",
      "expectedFeedback": "第一次打开 drawer 时，member 立即显示 Project Members 的 member template permissions，而不是旧缓存或空权限。",
      "note": "首次可见的 effective access 必须反映真实成员模板，作为后续升权/降权变化的基线。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "promote-member-admin",
      "sceneId": "project-settings",
      "intent": "Promote the joined member to project admin and save the new group membership.",
      "action": "Promote member to admin",
      "target": "settings__project-admins-save",
      "expectedFeedback": "成员升权后立即出现在 Project Admins 中，并且 effective permissions 立即切换到 admin template permissions。",
      "note": "升权之后必须马上看到 access group 变化，而不是等 cache 自己过期。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reopen-member-effective-access-after-promotion",
      "sceneId": "project-members",
      "intent": "Reopen the member drawer and confirm the promoted access is reflected immediately.",
      "action": "Reopen member effective access",
      "target": "member-detail__effective-access-summary",
      "expectedFeedback": "effective access 立即切换到 Project Admins，并展示 admin template permissions。",
      "note": "升权不应该等待后台缓存超时才生效。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "demote-member-back",
      "sceneId": "project-settings",
      "intent": "Remove the member from project admin group and save the lower access state.",
      "action": "Demote member back",
      "target": "settings__project-admins-save",
      "expectedFeedback": "成员降权后立即回到 Project Members，并恢复 member template permissions。",
      "note": "降权同样必须立刻反映到 access group 和 effective access.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "remove-member",
      "sceneId": "project-members",
      "intent": "Remove the member from the project and verify the access disappears immediately.",
      "action": "Remove member",
      "target": "members__table",
      "expectedFeedback": "成员被移除后，effective access 不能继续显示旧的 project access。",
      "note": "移除后必须立即失去项目访问，不允许 drawer 继续展示旧能力。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-removed-access",
      "sceneId": "project-overview",
      "intent": "Re-login the removed member in a fresh session and confirm the project is no longer accessible.",
      "action": "Verify removed access",
      "target": "project-overview__page",
      "expectedFeedback": "移除后在新会话里访问项目时，应无法再在项目列表中发现它，直接打开时则进入 Project unavailable 恢复面，而不是 generic error 或旧缓存。",
      "note": "必须用 fresh member session 复验，先确认 removed member 不再 discover 该项目，再确认项目布局层给出 Project unavailable 恢复面，避免同一 SPA context 里的旧 React Query 缓存掩盖真实后端不可访问状态。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for membership change and effective access.
