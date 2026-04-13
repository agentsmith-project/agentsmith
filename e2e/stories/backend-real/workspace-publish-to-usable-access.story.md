---
{
  "storyId": "workspace-publish-to-usable-access",
  "title": "Workspace publish to usable access",
  "actor": "system 管理侧 / workspace admin",
  "family": "workspace-publish",
  "personas": [
    "system 管理侧",
    "workspace admin"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/system/login",
  "goal": "system 管理侧完成工作区 bootstrap 并发布工作区后，被指定的 workspace admin 应该能立刻在浏览器和 API 里使用这个工作区，而不是再经历一轮人工排障。",
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
      "note": "backend-real publish story verifies a real IdP configuration before the workspace is published."
    }
  ],
  "preconditions": [
    "backend-real stack is ready",
    "system 管理侧账户可用",
    "workspace IdP configuration is reachable"
  ],
  "runtimeData": {
    "workspacePublishUsable": {
      "workspaceNamePrefix": "Story Publish Usable",
      "adminEmail": "dev-admin@example.com"
    }
  },
  "narrative": "工作区可用性的真相不是 system 管理侧看到 ready 就结束，而是先完成 bootstrap：验证身份源、确定管理员交接路径、发布工作区，再让指定 admin 立刻能在浏览器和 API 里进入工作区。",
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
        "system-workspaces__new-workspace"
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
      "note": "发布链路的起点仍然是明确的 system 管理侧入口。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "publish-workspace",
      "sceneId": "system-workspaces",
      "intent": "Bootstrap workspace identity and administrator handoff, then publish the workspace for a designated admin.",
      "action": "Bootstrap and publish workspace",
      "target": "system-workspaces__new-workspace",
      "expectedFeedback": "新工作区完成 bootstrap 并发布成功。",
      "note": "这里的成功不是点击过发布，而是身份源、管理员交接和工作区状态都已经进入可访问真相。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "login-workspace-admin",
      "sceneId": "workspace-projects",
      "intent": "Sign in as the designated workspace admin after publish.",
      "action": "Login workspace admin",
      "target": "projects__create-btn",
      "expectedFeedback": "workspace admin 能进入项目入口页。",
      "note": "发布后第一位 workspace admin 应该能直接进入工作区项目入口。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-workspace-usable",
      "sceneId": "workspace-projects",
      "intent": "Verify the published workspace is usable in both browser and API flows.",
      "action": "Verify workspace usable",
      "target": "projects__create-btn",
      "expectedFeedback": "浏览器和 API 都能访问已发布工作区。",
      "note": "真正的可用必须同时覆盖浏览器访问和 API 读取。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for published workspace becoming immediately usable.
