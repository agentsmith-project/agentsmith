---
{
  "storyId": "workspace-idp-and-admin-handoff",
  "title": "Workspace IdP and admin handoff",
  "actor": "system 管理侧",
  "family": "workspace-publish",
  "personas": [
    "system 管理侧"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/system/login",
  "goal": "system 管理侧在工作区发布前，应该明确知道管理员交接会走目录用户立即绑定，还是邮箱待绑定后首次登录完成绑定，而不是把这层差异留给发布后的排障。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [
    {
      "dependencyId": "workspace-idp-configuration",
      "kind": "integration",
      "required": true,
      "note": "backend-real handoff story verifies both directory-backed and email-pending administrator handoff paths against a real IdP."
    }
  ],
  "preconditions": [
    "backend-real stack is ready",
    "system 管理侧账户可用",
    "workspace IdP configuration is reachable"
  ],
  "runtimeData": {
    "workspaceIdpAdminHandoff": {
      "workspaceNamePrefix": "Story Handoff Truth",
      "directoryAdminEmail": "dev-admin@example.com",
      "pendingAdminEmail": "pending-admin@example.com"
    }
  },
  "narrative": "管理员交接的真相应该在 system 管理侧创建工作区时就说清楚：如果目录搜索可用，管理员会在创建阶段立即绑定；如果目录搜索不可用，系统会明确退回邮箱待绑定模式，并给出后续第一次登录的交接路径。",
  "scenes": [
    {
      "sceneId": "system-login",
      "route": "/en-US/system/login",
      "stableMarkers": [
        "system-login__heading"
      ]
    },
    {
      "sceneId": "workspace-create-review",
      "route": "/en-US/system/workspaces/new",
      "stableMarkers": [
        "system-workspace-create__handoff-state",
        "system-workspace-create__login-preview"
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
      "note": "管理员交接真相从 system 管理侧入口开始。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "review-directory-backed-handoff",
      "sceneId": "workspace-create-review",
      "intent": "Verify that a directory-backed workspace can bind the administrator immediately before create.",
      "action": "Review directory-backed handoff",
      "target": "system-workspace-create__handoff-state",
      "expectedFeedback": "目录用户立即绑定的管理员交接真相可见。",
      "note": "目录搜索可用时，system 管理侧应该在 review 阶段就看到管理员已绑定，而不是只看到一条模糊的登录路径。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "review-email-pending-handoff",
      "sceneId": "workspace-create-review",
      "intent": "Verify that the fallback path clearly switches to pending email binding when directory search is unavailable.",
      "action": "Review email-pending handoff",
      "target": "system-workspace-create__handoff-state",
      "expectedFeedback": "邮箱待绑定的管理员交接真相可见。",
      "note": "目录搜索不可用时，system 管理侧应该明确知道管理员会在首次匹配登录后完成绑定。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for workspace IdP verification and administrator handoff truth.
