---
{
  "storyId": "workspace-settings-save-and-effect",
  "title": "Workspace settings save and effect",
  "actor": "workspace admin / project creator",
  "family": "workspace-settings",
  "personas": [
    "workspace admin",
    "project creator"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/settings",
  "goal": "工作区管理员在 settings 中保存 project creator 后，creator 立即能看到创建项目入口并成功创建项目。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible",
    "integration creator user exists in the workspace directory"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "workspaceSettingsSaveEffect": {
      "creatorEmail": "integration-user@example.com",
      "projectNamePrefix": "Story Creator Effect"
    }
  },
  "narrative": "工作区设置的高频目标不是搜索目录本身，而是管理员保存 creator 配置后，这个授权能立刻在 creator 的日常项目入口上生效。",
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
        "projects__create-btn"
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
      "stepId": "open-workspace-settings",
      "sceneId": "workspace-settings",
      "intent": "Open workspace settings and review the creator management section.",
      "action": "Open workspace settings",
      "target": "ws-settings__project-creators",
      "expectedFeedback": "工作区 project creator 配置面可见。",
      "note": "工作区设置应该把 creator 配置作为可保存的治理动作，而不是一次性搜索结果。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "save-project-creator",
      "sceneId": "workspace-settings",
      "intent": "Save a project creator from the workspace directory results.",
      "action": "Save project creator",
      "target": "ws-settings__project-creators-save",
      "expectedFeedback": "project creator 已保存到工作区配置中。",
      "note": "保存动作必须形成明确结果，而不是只在输入框里短暂显示命中项。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-project-creator-effect",
      "sceneId": "workspace-projects",
      "intent": "Sign in as the granted creator and verify project creation is available immediately.",
      "action": "Verify project creator effect",
      "target": "projects__create-btn",
      "expectedFeedback": "creator 看到创建项目入口并成功进入新项目。",
      "note": "授权效果要落到 creator 的实际使用入口上，而不是停留在设置页提示。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "externalDependencies": []
}
---
Canonical backend-real story for saving workspace project creators and seeing the effect immediately.
