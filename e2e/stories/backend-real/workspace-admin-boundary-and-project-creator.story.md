---
{
  "storyId": "workspace-admin-boundary-and-project-creator",
  "title": "Workspace admin boundary and project creator",
  "actor": "workspace admin / project creator",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/settings",
  "goal": "workspace admin 配置 project creator 后，被授权用户能创建项目，但不能获得 workspace admin 能力。",
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible",
    "integration creator user exists in the workspace directory"
  ],
  "seedData": [
    "ws_default"
  ],
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "runtimeData": {
    "workspaceAdminProjectCreatorBoundary": {
      "creatorEmail": "integration-user@example.com",
      "projectNamePrefix": "Creator Boundary"
    }
  },
  "narrative": "工作区管理员的高频治理动作，是明确谁可以创建项目；被授权的 project creator 应该立刻在项目入口得到创建能力，但不应看到 workspace admin 的治理入口。",
  "scenes": [
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
        "projects__page",
        "projects__create-btn"
      ]
    },
    {
      "sceneId": "project-settings",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/settings",
      "stableMarkers": [
        "settings__project-owner-save"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-workspace-creator-management",
      "sceneId": "workspace-settings",
      "intent": "Open workspace settings and review the project creator management section.",
      "action": "Open creator management",
      "target": "ws-settings__project-creators",
      "expectedFeedback": "workspace admin 能看到 project creator 管理入口。",
      "note": "工作区管理员应在 workspace settings 完成 creator 授权，而不是去项目页面里逐个补权限。",
      "evidence": ["trace"]
    },
    {
      "stepId": "save-project-creator",
      "sceneId": "workspace-settings",
      "intent": "Save a project creator from the directory search results.",
      "action": "Save project creator",
      "target": "ws-settings__project-creators-save",
      "expectedFeedback": "project creator 已保存到工作区配置中。",
      "note": "保存动作应形成稳定结果，而不是临时搜索命中。",
      "evidence": ["trace"]
    },
    {
      "stepId": "creator-project-entry",
      "sceneId": "workspace-projects",
      "intent": "Sign in as the delegated creator and confirm project creation is available from the normal workspace entry.",
      "action": "Enter creator project entry",
      "target": "projects__create-btn",
      "expectedFeedback": "project creator 从项目入口看到创建项目动作。",
      "note": "creator 的日常入口应该是 projects，而不是 workspace settings。",
      "evidence": ["trace"]
    },
    {
      "stepId": "creator-workspace-boundary",
      "sceneId": "workspace-settings",
      "intent": "Verify the delegated creator cannot use workspace admin settings.",
      "action": "Verify workspace admin boundary",
      "expectedFeedback": "project creator 无法进入 workspace admin 设置面。",
      "note": "被授予创建项目，不等于继承 workspace admin。",
      "evidence": ["trace"]
    },
    {
      "stepId": "creator-create-project",
      "sceneId": "project-settings",
      "intent": "Create a project and confirm the creator now has project-owner level project settings access.",
      "action": "Create project as creator",
      "target": "settings__project-owner-save",
      "expectedFeedback": "project creator 成功创建项目，并获得该项目的 owner 级治理入口。",
      "note": "边界应收在项目级：creator 可以拥有自己新建项目，但仍不是 workspace admin。",
      "evidence": ["trace"]
    }
  ],
  "family": "workspace-admin-boundary-and-project-creator",
  "personas": [
    "workspace admin",
    "project creator"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for workspace admin delegating project creators without granting workspace admin capability.
