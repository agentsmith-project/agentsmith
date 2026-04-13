---
{
  "storyId": "workspace-lifecycle-admin-operations",
  "title": "Workspace lifecycle admin operations",
  "actor": "system 管理侧 / workspace admin",
  "family": "workspace-lifecycle-admin-operations",
  "personas": [
    "system 管理侧",
    "workspace admin"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/system/login",
  "goal": "system 管理侧对一个已上线 workspace 做一次 day-2 维护核验，重新确认它的 IdP 和 workspace login 仍然真实可访问。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "system 管理侧账户可用",
    "ws_default exists and is ready"
  ],
  "seedData": [
    "ws_default"
  ],
  "externalDependencies": [],
  "narrative": "day-2 维护不是重复发布，而是系统管理侧对已有 live workspace 做一次 revalidation，并确认 workspace 仍能被真实用户访问。",
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
      "route": "/en-US/system/workspaces?workspace=ws_default",
      "stableMarkers": [
        "system-workspaces__card--ws_default",
        "system-workspaces__open-workspace-login--ws_default"
      ]
    },
    {
      "sceneId": "workspace-login",
      "route": "/en-US/workspaces/ws_default/login",
      "stableMarkers": [
        "workspace-login__keycloak-btn"
      ]
    },
    {
      "sceneId": "workspace-projects",
      "route": "/en-US/workspaces/ws_default/projects",
      "stableMarkers": [
        "projects__create-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "system-login",
      "sceneId": "system-login",
      "intent": "Open the system administration login.",
      "action": "Open system login",
      "target": "system-login__heading",
      "expectedFeedback": "system 管理侧登录入口可用。",
      "note": "system 管理侧仍然是这条维护链路的起点。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "system-workspaces",
      "sceneId": "system-workspaces",
      "intent": "Review the existing live workspace in the system workspace list.",
      "action": "Review live workspace",
      "target": "system-workspaces__card--ws_default",
      "expectedFeedback": "已上线 workspace 仍在 system workspaces 清单中。",
      "note": "维护动作必须先确认 live workspace 仍在 system 管理侧可见。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "live-workspace-maintenance",
      "sceneId": "system-workspaces",
      "intent": "Open the live workspace in edit mode and revalidate its current IdP settings without changing the workspace lifecycle state.",
      "action": "Revalidate live workspace",
      "target": "system-workspaces__verify-idp",
      "expectedFeedback": "系统管理侧完成一次 live workspace 维护核验。",
      "note": "day-2 维护的重点是重新核验当前配置，而不是重新发布工作区。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-login",
      "sceneId": "workspace-login",
      "intent": "Sign in through the workspace login after maintenance to verify the workspace remains reachable.",
      "action": "Login workspace admin",
      "target": "projects__create-btn",
      "expectedFeedback": "workspace admin 仍然可以进入项目入口页。",
      "note": "维护之后必须再次验证浏览器入口仍然真实可访问。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-projects",
      "sceneId": "workspace-projects",
      "intent": "Confirm the workspace projects surface is still reachable after the maintenance check.",
      "action": "Verify workspace projects",
      "target": "projects__create-btn",
      "expectedFeedback": "workspace projects 页面仍然可访问。",
      "note": "如果 projects 入口不可达，说明维护后可访问性没有被确认。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for day-2 maintenance of an already live workspace.
