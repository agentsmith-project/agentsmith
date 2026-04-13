---
{
  "storyId": "workspace-shared-context-continuity",
  "title": "Workspace shared context continuity",
  "actor": "workspace admin / workspace member",
  "family": "workspace-shared-context",
  "personas": [
    "workspace admin",
    "workspace member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/settings/context",
  "goal": "工作区管理员维护 shared context 后，成员应该继续清楚知道这属于治理面共享说明，而自己的 My Workspace Context 仍然是私有上下文；当成员先通过项目列表加入项目，再进入 project use-guide 时，也应该能看见 workspace personal context entries 仍然在 readiness 里生效。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [],
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is accessible",
    "workspace admin and workspace member can both log in"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "workspaceSharedContext": {
      "sharedKey": "shared.review_policy.workspace_default",
      "sharedValue": "Always review workspace-level policy changes before publishing.",
      "privateKey": "personal.workspace.shortcuts.alerts",
      "privateValue": "Pin alerts follow-up and usage review in my workspace personal context entries."
    },
    "projectUseGuide": {
      "projectNamePrefix": "Story Workspace Shared Context",
      "endpointNamePrefix": "Story Workspace Shared Context Endpoint",
      "credentialNamePrefix": "Story Workspace Shared Context Credential",
      "model": "story-workspace-shared-context-model"
    }
  },
  "narrative": "workspace shared context 的真实心智不是让成员直接编辑治理条目，而是验证管理员维护共享说明之后，成员仍然通过自己的私有 workspace context 继续工作、先通过项目列表加入项目，并且在 project use-guide 中能看见 workspace personal context entries 继续参与 readiness。",
  "scenes": [
    {
      "sceneId": "workspace-shared-context",
      "route": "/en-US/workspaces/{workspaceId}/settings/context",
      "stableMarkers": [
        "context-store__list-card"
      ]
    },
    {
      "sceneId": "workspace-personal-context",
      "route": "/en-US/workspaces/{workspaceId}/context",
      "stableMarkers": [
        "context-store__list-card"
      ]
    },
    {
      "sceneId": "project-use-guide",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/use-guide",
      "stableMarkers": [
        "use-guide__page",
        "use-guide__status-context"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-workspace-shared-context",
      "sceneId": "workspace-shared-context",
      "intent": "Open the governance-owned workspace shared context surface.",
      "action": "Open workspace shared context",
      "target": "context-store__list-card",
      "expectedFeedback": "管理员进入 Shared Context 页面，看到这是 workspace 级共享治理说明。",
      "note": "shared context 必须由治理面维护，而不是被成员误认成自己的私有设置页。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "save-workspace-shared-context",
      "sceneId": "workspace-shared-context",
      "intent": "Save a shared workspace context entry that should remain governance-owned.",
      "action": "Save workspace shared context",
      "target": "context-store__save",
      "expectedFeedback": "shared context 保存成功，并继续留在治理页面。",
      "note": "共享说明需要作为长期 continuity 被留在 workspace 治理面。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-member-shared-context-boundary",
      "sceneId": "workspace-personal-context",
      "intent": "Confirm a regular member does not get the shared context editor and instead sees the private personal context surface.",
      "action": "Verify member shared context boundary",
      "target": "context-store__list-card",
      "expectedFeedback": "成员不会进入 shared context 编辑页，而是继续在自己的 My Workspace Context 里工作。",
      "note": "成员对 shared context 的正确感知，是知道它存在于治理面，而不是能直接修改。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "join-project-before-use-guide",
      "sceneId": "project-use-guide",
      "intent": "Join the project through the real project list prerequisite before checking use-guide readiness.",
      "action": "Join project before use guide",
      "target": "projects__join-project-btn--{projectId}",
      "expectedFeedback": "成员先通过项目列表成为 joined project member，然后再继续看 use-guide readiness。",
      "note": "use-guide readiness 的前提是成员已经成为 joined project member。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-member-private-context-boundary",
      "sceneId": "workspace-personal-context",
      "intent": "Save a private workspace context entry and confirm member-private continuity stays available.",
      "action": "Verify member private context boundary",
      "target": "context-store__save",
      "expectedFeedback": "成员能够继续保存自己的私有 workspace context，说明 shared continuity 和 private continuity 彼此独立。",
      "note": "shared context 不应挤掉成员自己的私有 workspace personal context entries。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-project-use-guide-readiness",
      "sceneId": "project-use-guide",
      "intent": "Open project use-guide as a joined project member and confirm workspace personal context entries still participate in readiness there.",
      "action": "Verify project use-guide readiness",
      "target": "use-guide__status-context",
      "expectedFeedback": "成员作为 joined project member 进入 project use-guide 时，仍然能看到 workspace personal context entries 的 readiness。",
      "note": "shared context continuity 不是停在设置页，而是继续出现在项目使用的准备状态里。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for workspace shared context continuity.
