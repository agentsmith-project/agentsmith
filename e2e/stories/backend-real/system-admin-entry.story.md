---
{
  "storyId": "system-admin-entry",
  "title": "System admin entry",
  "actor": "system 管理侧",
  "lane": "backend-real",
  "entryRoute": "/en-US/system/login",
  "goal": "system 管理侧登录后稳定进入工作区清单页，不出现多余的拒绝访问闪烁。",
  "preconditions": [
    "backend-real stack is ready",
    "system admin credentials are configured"
  ],
  "gatePolicy": {
    "tier": "release",
    "requiredEvidence": [
      "trace"
    ]
  },
  "seedData": [
    "ws_default"
  ],
  "narrative": "system 管理侧的首要目标是稳定进入工作区清单页，并把后续 workspace discovery 建立在明确的管理侧登录结果上。",
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
    }
  ],
  "steps": [
    {
      "stepId": "system-login",
      "sceneId": "system-login",
      "intent": "Open the system login entry.",
      "action": "Open system login",
      "target": "system-login__heading",
      "expectedFeedback": "system 管理侧登录入口",
      "note": "system 管理侧登录入口",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "system-workspaces",
      "sceneId": "system-workspaces",
      "intent": "Review the system workspace index.",
      "action": "Review system workspaces",
      "target": "system-workspaces__heading",
      "expectedFeedback": "工作区清单与创建入口",
      "note": "工作区清单与创建入口",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "system-admin-entry",
  "personas": [
    "system 管理侧"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for the system admin entry surface.
