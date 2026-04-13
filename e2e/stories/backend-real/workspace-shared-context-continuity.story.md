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
  "goal": "工作区管理员维护 shared context 后，成员应该继续清楚知道这属于治理面共享说明，而自己的 My Workspace Context 仍然是私有上下文，两者不会混淆。",
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
      "privateValue": "Pin alerts follow-up and usage review in my workspace defaults."
    }
  },
  "narrative": "workspace shared context 的真实心智不是让成员直接编辑治理条目，而是验证管理员维护共享说明之后，成员仍然通过自己的私有 workspace context 继续工作，并清楚知道 shared context 和 private context 是两条不同的线。",
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
      "stepId": "verify-member-private-context-boundary",
      "sceneId": "workspace-personal-context",
      "intent": "Save a private workspace context entry and confirm member-private continuity stays available.",
      "action": "Verify member private context boundary",
      "target": "context-store__save",
      "expectedFeedback": "成员能够继续保存自己的私有 workspace context，说明 shared continuity 和 private continuity 彼此独立。",
      "note": "shared context 不应挤掉成员自己的私有 workspace defaults。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---

Canonical backend-real story for workspace shared context continuity.
