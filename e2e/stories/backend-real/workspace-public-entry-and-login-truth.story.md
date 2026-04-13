---
{
  "storyId": "workspace-public-entry-and-login-truth",
  "title": "Workspace public entry and login truth",
  "actor": "workspace member / invited user",
  "lane": "backend-real",
  "entryRoute": "/en-US/login/workspace",
  "goal": "普通用户从公开入口进入时，能确认自己到了正确工作区，并清楚知道下一步如何登录。",
  "preconditions": [
    "backend-real stack is ready",
    "ws_default is published",
    "public workspace directory is available"
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
  "narrative": "A public user should start from workspace selection, open the intended workspace entry, confirm the workspace identity on the login page, and understand that the next step is signing in with the workspace identity provider.",
  "scenes": [
    {
      "sceneId": "workspace-selection",
      "route": "/en-US/login/workspace",
      "stableMarkers": [
        "workspace-select__list",
        "workspace-select__item--ws_default"
      ]
    },
    {
      "sceneId": "workspace-login",
      "route": "/en-US/workspaces/ws_default/login",
      "stableMarkers": [
        "workspace-login__heading",
        "workspace-login__keycloak-btn",
        "workspace-login__back-to-selection"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "workspace-selection",
      "sceneId": "workspace-selection",
      "intent": "Open the public workspace entry and choose the intended workspace.",
      "action": "Choose workspace entry",
      "target": "workspace-select__item--ws_default",
      "expectedFeedback": "用户能从公开入口选中目标工作区。",
      "note": "公开入口应先帮助用户确认要进入哪个工作区。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-login-identity",
      "sceneId": "workspace-login",
      "intent": "Confirm the login page belongs to the selected workspace.",
      "action": "Confirm workspace identity",
      "target": "workspace-login__heading",
      "expectedFeedback": "登录页展示与公开入口一致的工作区身份。",
      "note": "工作区登录页必须清楚说明当前入口对应哪个工作区。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "workspace-login-next-step",
      "sceneId": "workspace-login",
      "intent": "Understand the next login action and the way back to workspace selection.",
      "action": "Review login next step",
      "target": "workspace-login__keycloak-btn",
      "expectedFeedback": "用户知道下一步是用该工作区的身份入口继续登录，并能返回工作区选择。",
      "note": "下一步登录动作和返回工作区选择的入口必须同时真实可见。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "workspace-public-entry-and-login-truth",
  "personas": [
    "workspace member",
    "invited user"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for public workspace entry and workspace-specific login truth.
