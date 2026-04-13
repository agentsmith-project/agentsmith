---
{
  "storyId": "workspace-identity-switch-truth",
  "title": "Workspace identity switch truth",
  "actor": "workspace member / invited user",
  "family": "workspace-identity-switch-truth",
  "personas": [
    "workspace member",
    "invited user"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/login/workspace",
  "goal": "同一个人退出一个工作区后，再进入另一个工作区时，系统只保留新的工作区语境，不把旧 workspace 的 project continuation 或个人上下文带过去。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "seedData": [
    "ws_default"
  ],
  "externalDependencies": [],
  "runtimeData": {
    "workspaceIdentitySwitchTruth": {
      "sourceWorkspaceId": "ws_default",
      "targetWorkspaceNamePrefix": "Story Identity Switch Target",
      "targetWorkspaceAdminEmail": "dev-admin@example.com",
      "staleProjectId": "proj_001"
    }
  },
  "preconditions": [
    "backend-real stack is ready",
    "ws_default is published",
    "a second workspace can be created and published during the story",
    "public workspace directory is available"
  ],
  "narrative": "A person who is leaving one workspace should be able to sign out, pick another workspace, and see a login and landing path that belongs only to the new workspace. The old workspace's continuation must not bleed into the next one.",
  "scenes": [
    {
      "sceneId": "workspace-selection",
      "route": "/en-US/login/workspace",
      "stableMarkers": [
        "workspace-select__list",
        "workspace-select__item--ws_default",
        "workspace-select__item--{targetWorkspaceId}"
      ]
    },
    {
      "sceneId": "source-workspace-login",
      "route": "/en-US/workspaces/ws_default/login",
      "stableMarkers": [
        "workspace-login__heading",
        "workspace-login__keycloak-btn",
        "workspace-login__back-to-selection"
      ]
    },
    {
      "sceneId": "target-workspace-login",
      "route": "/en-US/workspaces/{targetWorkspaceId}/login",
      "stableMarkers": [
        "workspace-login__heading",
        "workspace-login__keycloak-btn",
        "workspace-login__back-to-selection"
      ]
    },
    {
      "sceneId": "target-workspace-projects",
      "route": "/en-US/workspaces/{targetWorkspaceId}/projects",
      "stableMarkers": [
        "projects__page",
        "projects__create-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-workspace-selection",
      "sceneId": "workspace-selection",
      "intent": "Open the public workspace selection and choose the current workspace before switching away.",
      "action": "Open workspace selection",
      "target": "workspace-select__list",
      "expectedFeedback": "用户能同时看到可进入的工作区。",
      "note": "公共入口要让人先确认自己正从哪个 workspace 开始。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "enter-source-workspace",
      "sceneId": "source-workspace-login",
      "intent": "Sign in to the first workspace so there is a real current identity to leave behind.",
      "action": "Sign in to source workspace",
      "target": "workspace-login__keycloak-btn",
      "expectedFeedback": "用户先完成第一个工作区的登录。",
      "note": "切换身份前，必须先有一个真实的已登录 workspace 作为起点。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "sign-out-from-source-workspace",
      "sceneId": "source-workspace-login",
      "intent": "Leave the first workspace and return to the public chooser without keeping stale continuation state.",
      "action": "Sign out from source workspace",
      "target": "user-menu__logout",
      "expectedFeedback": "退出后回到公共工作区选择，不应保留旧 workspace 的 continuation。",
      "note": "退出动作必须真正把旧身份的继续状态清掉。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "choose-target-workspace",
      "sceneId": "workspace-selection",
      "intent": "Choose a different workspace and make sure the next login page belongs only to that workspace.",
      "action": "Choose target workspace",
      "target": "workspace-select__item--",
      "targetMatch": "prefix",
      "expectedFeedback": "目标 workspace 的登录页应保持干净，不带前一个 workspace 的 project continuation。",
      "note": "选择另一个 workspace 时，系统不能把旧 project 一起搬过去。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "confirm-target-login",
      "sceneId": "target-workspace-login",
      "intent": "Confirm the target workspace login page is truthful and not polluted by the previous workspace.",
      "action": "Confirm target workspace login",
      "target": "workspace-login__heading",
      "expectedFeedback": "目标 workspace 的身份和返回路径都只属于它自己。",
      "note": "登录页的标题、返回入口和后续 landing 都必须是目标 workspace 的真相。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "sign-in-to-target-workspace",
      "sceneId": "target-workspace-login",
      "intent": "Sign in to the second workspace and continue from its own clean landing path.",
      "action": "Sign in to target workspace",
      "target": "workspace-login__keycloak-btn",
      "expectedFeedback": "新的身份进入后，系统应继续到目标 workspace 自己的 projects surface。",
      "note": "新身份不应继承旧 workspace 的 project continuation。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "land-on-target-projects",
      "sceneId": "target-workspace-projects",
      "intent": "Land on the target workspace projects page and verify the new identity is stable.",
      "action": "Land on target workspace projects",
      "target": "projects__create-btn",
      "expectedFeedback": "目标 workspace 的 projects list 稳定可见。",
      "note": "切换后的 landing 必须像真正的新 workspace，而不是旧 workspace 的延续。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for same-human workspace identity switching without stale continuation bleed.
