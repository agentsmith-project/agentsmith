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
  "goal": "system 管理侧发布工作区后，被指定的 workspace admin 应该能立刻在浏览器和 API 里使用这个工作区，而不是再经历一轮人工排障。",
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
  "narrative": "工作区发布主故事不是停留在 system 管理侧状态变为 ready，而是让指定 admin 立刻能在浏览器里进入工作区、在 API 里拿到项目入口数据，证明发布已经真正可用。",
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
      "intent": "Create and publish a workspace for a designated admin.",
      "action": "Publish workspace",
      "target": "system-workspaces__new-workspace",
      "expectedFeedback": "新工作区创建、配置并发布完成。",
      "note": "发布完成的定义不是按钮点过，而是工作区进入可访问状态。",
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
