---
{
  "storyId": "real-backend-visual-review",
  "title": "Backend-real visual review",
  "actor": "system 管理侧 / project owner",
  "lane": "backend-real",
  "entryRoute": "/en-US/system/login",
  "goal": "用真实 backend 复核系统、工作区和项目核心界面的 UX/UI 质量。",
  "preconditions": [
    "real backend stack is ready",
    "Keycloak and provider API key are configured"
  ],
  "seedData": [
    "ws_default"
  ],
  "narrative": "真实 backend 视觉巡检需要覆盖系统入口、workspace 操作、project work surfaces、governance surfaces 和关键对话框。",
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
        "system-workspaces__list",
        "system-workspaces__new-workspace"
      ]
    },
    {
      "sceneId": "system-info",
      "route": "/en-US/system/info",
      "stableMarkers": [
        "system-info__shell"
      ]
    },
    {
      "sceneId": "workspace-login",
      "route": "/en-US/workspaces/{workspaceId}/login",
      "stableMarkers": [
        "workspace-login__heading"
      ]
    },
    {
      "sceneId": "workspace-home",
      "route": "/en-US/workspaces/{workspaceId}",
      "stableMarkers": [
        "workspace-overview__heading"
      ]
    },
    {
      "sceneId": "workspace-settings",
      "route": "/en-US/workspaces/{workspaceId}/settings",
      "stableMarkers": [
        "ws-settings__summary-line"
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
        "project-overview__page"
      ]
    },
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
      "stableMarkers": [
        "chat__main-pane"
      ]
    },
    {
      "sceneId": "project-notebook",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/notebook",
      "stableMarkers": [
        "notebook__task-list"
      ]
    },
    {
      "sceneId": "project-files",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/files",
      "stableMarkers": [
        "files__library-create"
      ]
    },
    {
      "sceneId": "project-endpoints",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/endpoints",
      "stableMarkers": [
        "endpoints__create-btn"
      ]
    },
    {
      "sceneId": "project-credentials",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/credentials",
      "stableMarkers": [
        "credentials__create-btn"
      ]
    },
    {
      "sceneId": "project-agents",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agents",
      "stableMarkers": [
        "agents__create-btn"
      ]
    },
    {
      "sceneId": "project-members",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/members",
      "stableMarkers": [
        "members__search-input"
      ]
    },
    {
      "sceneId": "project-resource-policy",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/resource-policy",
      "stableMarkers": [
        "resource-policy__editor"
      ]
    },
    {
      "sceneId": "project-audit",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/audit",
      "stableMarkers": [
        "audit__page"
      ]
    },
    {
      "sceneId": "project-usage",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/usage",
      "stableMarkers": [
        "usage__work-surface"
      ]
    },
    {
      "sceneId": "project-settings",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/settings",
      "stableMarkers": [
        "settings__general-section"
      ]
    },
    {
      "sceneId": "project-use-guide",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/use-guide",
      "stableMarkers": [
        "use-guide__page"
      ]
    },
    {
      "sceneId": "project-alerts",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/alerts",
      "stableMarkers": [
        "alerts__main-surface"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "system-login",
      "sceneId": "system-login",
      "intent": "Open system login",
      "action": "Open system login",
      "target": "system-login__heading",
      "expectedFeedback": "system 管理侧登录入口",
      "note": "system 管理侧登录入口",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "system-workspaces",
      "sceneId": "system-workspaces",
      "intent": "Review system workspaces",
      "action": "Review system workspaces",
      "target": "system-workspaces__list",
      "expectedFeedback": "工作区清单与创建入口",
      "note": "工作区清单与创建入口",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "system-workspace-editor",
      "sceneId": "system-workspaces",
      "intent": "Review workspace editor",
      "action": "Review workspace editor",
      "target": "system-workspaces__list",
      "expectedFeedback": "新工作区创建并发布后的 system 管理侧工作区清单",
      "note": "新工作区创建并发布后的 system 管理侧工作区清单",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "system-info",
      "sceneId": "system-info",
      "intent": "Open system info",
      "action": "Open system info",
      "target": "system-info__shell",
      "expectedFeedback": "system 信息页",
      "note": "system 信息页",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "workspace-login",
      "sceneId": "workspace-login",
      "intent": "Open workspace login",
      "action": "Open workspace login",
      "target": "workspace-login__heading",
      "expectedFeedback": "工作区登录入口",
      "note": "工作区登录入口",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "workspace-home-admin",
      "sceneId": "workspace-home",
      "intent": "Open workspace home",
      "action": "Open workspace home",
      "target": "workspace-overview__heading",
      "expectedFeedback": "workspace admin 进入工作区首页",
      "note": "workspace admin 进入工作区首页",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "workspace-settings",
      "sceneId": "workspace-settings",
      "intent": "Open workspace settings",
      "action": "Open workspace settings",
      "target": "ws-settings__summary-line",
      "expectedFeedback": "工作区设置与 project creators 配置",
      "note": "工作区设置与 project creators 配置",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "workspace-projects-before-create",
      "sceneId": "workspace-projects",
      "intent": "Open projects list",
      "action": "Open projects list",
      "target": "projects__create-btn",
      "expectedFeedback": "project creator 的项目列表与创建入口",
      "note": "project creator 的项目列表与创建入口",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "dialog-create-project-real",
      "sceneId": "workspace-projects",
      "intent": "Open create project dialog",
      "action": "Open create project dialog",
      "target": "dialog[role=\\\"dialog\\\"]",
      "expectedFeedback": "真实环境创建项目对话框",
      "note": "真实环境创建项目对话框",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-overview",
      "sceneId": "project-overview",
      "intent": "Inspect project overview",
      "action": "Inspect project overview",
      "target": "project-overview__page",
      "expectedFeedback": "项目创建成功后的 overview",
      "note": "项目创建成功后的 overview",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-chat",
      "sceneId": "project-chat",
      "intent": "Open project chat",
      "action": "Open project chat",
      "target": "chat__main-pane",
      "expectedFeedback": "真实 backend 的 project chat",
      "note": "真实 backend 的 project chat",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-notebook",
      "sceneId": "project-notebook",
      "intent": "Open project notebook",
      "action": "Open project notebook",
      "target": "notebook__task-list",
      "expectedFeedback": "真实 backend 的 notebook 工作面",
      "note": "真实 backend 的 notebook 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-files",
      "sceneId": "project-files",
      "intent": "Open project files",
      "action": "Open project files",
      "target": "files__library-create",
      "expectedFeedback": "真实 backend 的 files 工作面",
      "note": "真实 backend 的 files 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-endpoints",
      "sceneId": "project-endpoints",
      "intent": "Open project endpoints",
      "action": "Open project endpoints",
      "target": "endpoints__create-btn",
      "expectedFeedback": "真实 backend 的 endpoint 工作面",
      "note": "真实 backend 的 endpoint 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-credentials",
      "sceneId": "project-credentials",
      "intent": "Open project credentials",
      "action": "Open project credentials",
      "target": "credentials__create-btn",
      "expectedFeedback": "真实 backend 的 credentials 工作面",
      "note": "真实 backend 的 credentials 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-agents",
      "sceneId": "project-agents",
      "intent": "Open project agents",
      "action": "Open project agents",
      "target": "agents__create-btn",
      "expectedFeedback": "真实 backend 的 agents 工作面",
      "note": "真实 backend 的 agents 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-members",
      "sceneId": "project-members",
      "intent": "Open project members",
      "action": "Open project members",
      "target": "members__search-input",
      "expectedFeedback": "真实 backend 的 members 工作面",
      "note": "真实 backend 的 members 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-resource-policy",
      "sceneId": "project-resource-policy",
      "intent": "Open project resource policy",
      "action": "Open project resource policy",
      "target": "resource-policy__editor",
      "expectedFeedback": "真实 backend 的 resource policy 工作面",
      "note": "真实 backend 的 resource policy 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-audit",
      "sceneId": "project-audit",
      "intent": "Open project audit",
      "action": "Open project audit",
      "target": "audit__page",
      "expectedFeedback": "真实 backend 的 audit 工作面",
      "note": "真实 backend 的 audit 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-usage",
      "sceneId": "project-usage",
      "intent": "Open project usage",
      "action": "Open project usage",
      "target": "usage__work-surface",
      "expectedFeedback": "真实 backend 的 usage 工作面",
      "note": "真实 backend 的 usage 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-settings",
      "sceneId": "project-settings",
      "intent": "Open project settings",
      "action": "Open project settings",
      "target": "settings__general-section",
      "expectedFeedback": "真实 backend 的 project settings 工作面",
      "note": "真实 backend 的 project settings 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-use-guide",
      "sceneId": "project-use-guide",
      "intent": "Open project use guide",
      "action": "Open project use guide",
      "target": "use-guide__page",
      "expectedFeedback": "真实 backend 的 use guide 工作面",
      "note": "真实 backend 的 use guide 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    },
    {
      "stepId": "project-alerts",
      "sceneId": "project-alerts",
      "intent": "Open project alerts",
      "action": "Open project alerts",
      "target": "alerts__main-surface",
      "expectedFeedback": "真实 backend 的 alerts 工作面",
      "note": "真实 backend 的 alerts 工作面",
      "evidence": [
        "trace",
        "visual"
      ]
    }
  ],
  "family": "real-backend-visual-review",
  "personas": [
    "system 管理侧",
    "project owner"
  ],
  "kind": "review",
  "gatePolicy": {
    "tier": "release",
    "requiredEvidence": [
      "trace",
      "visual"
    ]
  },
  "externalDependencies": []
}
---
