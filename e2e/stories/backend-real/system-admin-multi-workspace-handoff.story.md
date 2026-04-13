---
{
  "storyId": "system-admin-multi-workspace-handoff",
  "title": "System admin multi-workspace handoff and truthful re-entry",
  "actor": "system 管理侧 / workspace admin",
  "family": "system-admin-multi-workspace-handoff",
  "personas": [
    "system 管理侧",
    "workspace admin"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/system/login",
  "goal": "system 管理侧连续处理多个 workspace：先把两个工作区都 bootstrap 并发布，再把它们分别交给真实 workspace admin，之后还能用各自的真实 admin 身份重新进入，页面不能把多个工作区混成一套状态。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [
    {
      "dependencyId": "integration-keycloak-users",
      "kind": "integration",
      "required": true,
      "note": "backend-real multi-workspace story needs real Keycloak users for the workspace admin re-entry checks."
    },
    {
      "dependencyId": "workspace-idp-configuration",
      "kind": "integration",
      "required": true,
      "note": "each workspace must be bootstrapped against a real IdP configuration before publish."
    }
  ],
  "preconditions": [
    "backend-real stack is ready",
    "system 管理侧账户可用",
    "workspace IdP configuration is reachable",
    "Keycloak integration users are available"
  ],
  "runtimeData": {
    "systemAdminMultiWorkspaceHandoff": {
      "workspaceAlphaNamePrefix": "Story Multi Workspace Alpha",
      "workspaceBetaNamePrefix": "Story Multi Workspace Beta",
      "workspaceAlphaAdminEmail": "dev-admin@example.com",
      "workspaceBetaAdminEmail": "integration-member@example.com"
    }
  },
  "narrative": "system 管理侧关注的不是 workspace 数量本身，而是当多个 workspace 都已经 bootstrap 完成时，每个 workspace 的管理员交接都必须能独立成立，重新进入时也不能互相污染。",
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
      "sceneId": "workspace-login-alpha",
      "route": "/en-US/workspaces/{workspaceId}/login",
      "stableMarkers": [
        "workspace-login__keycloak-btn"
      ]
    },
    {
      "sceneId": "workspace-login-beta",
      "route": "/en-US/workspaces/{workspaceId}/login",
      "stableMarkers": [
        "workspace-login__keycloak-btn"
      ]
    },
    {
      "sceneId": "workspace-projects",
      "route": "/en-US/workspaces/{workspaceId}/projects",
      "stableMarkers": [
        "projects__create-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-system-login",
      "sceneId": "system-login",
      "intent": "Open the system administration login.",
      "action": "Open system login",
      "target": "system-login__heading",
      "expectedFeedback": "system 管理侧登录入口可用。",
      "note": "multiple workspace handoff 的起点依然是 system 管理侧入口。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "bootstrap-workspace-alpha",
      "sceneId": "system-workspaces",
      "intent": "Bootstrap the first workspace and bind the administrator truthfully.",
      "action": "Bootstrap workspace alpha",
      "target": "system-workspaces__card--",
      "targetMatch": "prefix",
      "expectedFeedback": "第一个 workspace 的管理员交接和发布真相成立。",
      "note": "system 管理侧需要能单独验证第一个 workspace 的 bootstrap 结果。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "bootstrap-workspace-beta",
      "sceneId": "system-workspaces",
      "intent": "Bootstrap the second workspace and bind its administrator truthfully as a separate object.",
      "action": "Bootstrap workspace beta",
      "target": "system-workspaces__card--",
      "targetMatch": "prefix",
      "expectedFeedback": "第二个 workspace 的管理员交接和发布真相成立。",
      "note": "第二个 workspace 的 bootstrap 不能复用或覆盖第一个 workspace 的交接状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "review-system-workspaces",
      "sceneId": "system-workspaces",
      "intent": "Review the system workspace index and confirm both workspaces remain distinct and reachable.",
      "action": "Review system workspaces",
      "target": "system-workspaces__list",
      "expectedFeedback": "两个 workspace 在 system 清单中都应保持独立可见。",
      "note": "清单页要能清楚表明这是两个独立 workspace，而不是一个混杂的交接状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reenter-workspace-alpha",
      "sceneId": "workspace-projects",
      "intent": "Re-enter the first workspace later and verify the designated admin can still reach it truthfully.",
      "action": "Re-enter workspace alpha",
      "target": "projects__create-btn",
      "expectedFeedback": "第一个 workspace 仍然可由其真实 admin 重新进入。",
      "note": "重新进入时要看到的是稳定的 workspace admin projects 入口，而不是一段泛化的登录说明。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reenter-workspace-beta",
      "sceneId": "workspace-projects",
      "intent": "Re-enter the second workspace later and verify its admin access remains distinct from the first workspace.",
      "action": "Re-enter workspace beta",
      "target": "projects__create-btn",
      "expectedFeedback": "第二个 workspace 也应保持独立且可重新进入。",
      "note": "第二个 workspace 的 re-entry 不能和第一个 workspace 混成一个模糊的管理态。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for system admins handling multiple workspaces and truthful later re-entry.
