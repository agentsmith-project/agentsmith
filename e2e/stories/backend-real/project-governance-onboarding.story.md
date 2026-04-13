---
{
  "storyId": "project-governance-onboarding",
  "title": "Project governance onboarding",
  "actor": "system 管理侧 / workspace admin / project creator / member / guest / invitee",
  "lane": "backend-real",
  "entryRoute": "/en-US/system/login",
  "goal": "完成 workspace 发布、project creator 授权，并验证 project visibility / join policy 的 onboarding 结果。",
  "preconditions": [
    "backend-real stack is ready",
    "Keycloak and external Keycloak are configured"
  ],
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "narrative": "项目治理 onboarding 的用户目标不是把所有矩阵细节都暴露出来，而是把 workspace 发布、creator 授权、公共/私有可见性和 join policy 的结果一次性验证清楚。",
  "scenes": [
    {
      "sceneId": "system-login",
      "route": "/en-US/system/login",
      "stableMarkers": [
        "system-login__heading"
      ]
    },
    {
      "sceneId": "system-workspaces",
      "route": "/en-US/system/workspaces",
      "stableMarkers": [
        "system-workspaces__heading"
      ]
    },
    {
      "sceneId": "workspace-settings",
      "route": "/en-US/workspaces/{workspaceId}/settings",
      "stableMarkers": [
        "ws-settings__project-creators"
      ]
    },
    {
      "sceneId": "workspace-projects",
      "route": "/en-US/workspaces/{workspaceId}/projects",
      "stableMarkers": [
        "projects__create-btn"
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
      "sceneId": "project-members",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/members",
      "stableMarkers": [
        "members__invite-btn"
      ]
    }
  ],
  "runtimeData": {
    "matrixSetup": {
      "workspaceNamePrefix": "Governance Matrix",
      "projectNamePrefix": "Governance Matrix",
      "defaultIdpLabel": "Default IdP",
      "externalIdpLabel": "External IdP"
    }
  },
  "steps": [
    {
      "stepId": "system-login",
      "sceneId": "system-login",
      "intent": "Open system login.",
      "action": "Open system login",
      "target": "system-login__heading",
      "expectedFeedback": "system 管理侧登录入口",
      "note": "system 管理侧登录入口",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-created-published",
      "sceneId": "system-workspaces",
      "intent": "Create and publish a workspace.",
      "action": "Create and publish workspace",
      "target": "system-workspaces__heading",
      "expectedFeedback": "新工作区创建并发布完成",
      "note": "新工作区创建并发布完成",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-project-creators-granted",
      "sceneId": "workspace-settings",
      "intent": "Grant project creators in the workspace settings.",
      "action": "Grant project creators",
      "target": "ws-settings__project-creators",
      "expectedFeedback": "工作区 project creators 已配置完成",
      "note": "工作区 project creators 已配置完成",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "public-project-discovery",
      "sceneId": "workspace-projects",
      "intent": "Discover public projects and the create entry.",
      "action": "Discover public projects",
      "target": "projects__create-btn",
      "expectedFeedback": "公共项目可见且可创建",
      "note": "公共项目可见且可创建",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "private-project-governance",
      "sceneId": "project-members",
      "intent": "Review the project governance for private access and join requests.",
      "action": "Review project governance",
      "target": "members__requests-tab",
      "expectedFeedback": "私有项目的 join policy 和审批路径已验证",
      "note": "私有项目的 join policy 和审批路径已验证",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "matrix-verification",
      "sceneId": "project-overview",
      "intent": "Verify the workspace/project access matrix after onboarding.",
      "action": "Verify access matrix",
      "target": "project-hub__page",
      "expectedFeedback": "workspace / project 访问矩阵已收敛到预期状态",
      "note": "workspace / project 访问矩阵已收敛到预期状态",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "project-governance-onboarding",
  "personas": [
    "system 管理侧",
    "workspace admin",
    "project creator",
    "member",
    "guest",
    "invitee"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for project governance onboarding.
