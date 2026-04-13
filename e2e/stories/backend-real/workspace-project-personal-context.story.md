---
{
  "storyId": "workspace-project-personal-context",
  "title": "Workspace and project personal context",
  "actor": "project member",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/context",
  "goal": "成员可以分别维护 workspace personal context 和 project personal context，并清楚看到项目内覆写不会修改 workspace 范围的个人配置。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "Keycloak and provider API key are configured"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "personalContext": {
      "projectName": "Story Personal Context",
      "contextKey": "personal.preferences.response_mode",
      "workspaceValue": "workspace-default-brief",
      "projectValue": "project-override-detailed"
    }
  },
  "narrative": "成员视角的 personal context 主故事不是共享治理，而是把自己的 workspace 偏好和项目内覆写明确区分开，并验证两者分别持久化。",
  "scenes": [
    {
      "sceneId": "workspace-personal-context",
      "route": "/en-US/workspaces/{workspaceId}/context",
      "stableMarkers": [
        "context-store__list-card"
      ]
    },
    {
      "sceneId": "project-personal-context",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/my-context",
      "stableMarkers": [
        "context-store__list-card"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-workspace-personal-context",
      "sceneId": "workspace-personal-context",
      "intent": "Open the workspace personal context page.",
      "action": "Open workspace personal context",
      "target": "user-menu__workspace-personal-context",
      "expectedFeedback": "成员看到 workspace personal context 编辑入口",
      "note": "成员看到 workspace personal context 编辑入口",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "save-workspace-personal-context",
      "sceneId": "workspace-personal-context",
      "intent": "Save a private workspace-level personal context entry.",
      "action": "Save workspace personal context",
      "target": "context-store__save",
      "expectedFeedback": "workspace personal context 保存成功",
      "note": "workspace personal context 保存成功",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-project-personal-context",
      "sceneId": "project-personal-context",
      "intent": "Open the project personal context page for the same member.",
      "action": "Open project personal context",
      "target": "user-menu__project-personal-context",
      "expectedFeedback": "成员看到 project personal context 编辑入口",
      "note": "成员看到 project personal context 编辑入口",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "save-project-personal-context",
      "sceneId": "project-personal-context",
      "intent": "Save a project-specific override for the same logical key.",
      "action": "Save project personal context",
      "target": "context-store__save",
      "expectedFeedback": "project personal context 保存成功",
      "note": "project personal context 保存成功",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-scoped-context",
      "sceneId": "project-personal-context",
      "intent": "Verify the workspace and project personal context scopes stay distinct.",
      "action": "Verify scoped personal context",
      "target": "context-store__editor-card",
      "expectedFeedback": "workspace 与 project personal context 各自保留正确值",
      "note": "workspace 与 project personal context 各自保留正确值",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "workspace-project-personal-context",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for workspace/project personal context.
