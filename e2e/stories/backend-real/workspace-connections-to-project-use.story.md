---
{
  "storyId": "workspace-connections-to-project-use",
  "title": "Workspace connections to project use",
  "actor": "workspace admin / project member",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/connections",
  "goal": "成员在工作区连接页确认共享集成和个人连接状态后，能够清楚地继续到项目使用的项目列表并打开 use-guide 作为第一次真正消费，而不是停在连接配置页。",
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is published",
    "Keycloak is configured"
  ],
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
    "workspaceConnectionsToProjectUse": {
      "projectNamePrefix": "Story Workspace Connections",
      "endpointNamePrefix": "Story Workspace Connections Endpoint",
      "credentialNamePrefix": "Story Workspace Connections Credential",
      "connectionDisplayNamePrefix": "Story Workspace Connections Connection",
      "connectionCustomDomainSuffix": "workspace-connections.storybook.example",
      "connectionToken": "workspace-connections-token",
      "connectionNote": "Workspace connections story connection",
      "model": "story-workspace-connections-model",
      "upstreamReplyText": "WORKSPACE_CONNECTIONS_READY"
    }
  },
  "narrative": "Workspace connections should not be a dead-end settings page; after checking that the workspace integration and personal connection are ready, the member should have a clear project-use handoff and a stable first-use guide.",
  "scenes": [
    {
      "sceneId": "workspace-connections",
      "route": "/en-US/workspaces/{workspaceId}/connections",
      "stableMarkers": [
        "workspace-connections__capability-note",
        "workspace-connections__open-projects",
        "workspace-connections__feishu-connect"
      ]
    },
    {
      "sceneId": "personal-connections",
      "route": "/en-US/user/third-party-accounts",
      "stableMarkers": [
        "third-party-accounts__create-btn"
      ]
    },
    {
      "sceneId": "project-use-guide",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/use-guide",
      "stableMarkers": [
        "use-guide__page",
        "use-guide__endpoint-select"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "review-workspace-connections",
      "sceneId": "workspace-connections",
      "intent": "Confirm workspace integration state and the next step into project use.",
      "action": "Review workspace connections",
      "target": "workspace-connections__next-step",
      "expectedFeedback": "用户能看到工作区集成状态，以及前往 project use 的明确下一步。",
      "note": "工作区连接页不能只停在状态说明，它必须把用户往项目使用带过去。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "create-or-refresh-personal-connection",
      "sceneId": "personal-connections",
      "intent": "Create or refresh a personal connection that the member can reuse when moving into project use.",
      "action": "Create or refresh personal connection",
      "target": "third-party-accounts__create-btn",
      "expectedFeedback": "用户能在个人连接页创建或刷新连接。",
      "note": "个人连接页是成员真正进入项目使用前的自助准备面。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-project-use-guide",
      "sceneId": "project-use-guide",
      "intent": "Open project use guide as the first concrete project consumption step.",
      "action": "Open project use guide",
      "target": "use-guide__page",
      "expectedFeedback": "成员可以看到项目的 canonical use guide。",
      "note": "第一次消费必须从 use-guide 开始，而不是绕去别的后台页。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-project-use-ready",
      "sceneId": "project-use-guide",
      "intent": "Choose an endpoint and confirm the canonical base URL can be consumed.",
      "action": "Verify project use ready",
      "target": "use-guide__endpoint-select",
      "expectedFeedback": "成员能选中 endpoint，并顺着 use-guide 进入真实调用路径。",
      "note": "use-guide 要独立承接第一次消费，而不是被其它故事顺手带到。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "workspace-connections-to-project-use",
  "personas": [
    "workspace admin",
    "project member"
  ],
  "kind": "journey"
}
---
Canonical backend-real story for workspace connections handoff into first project use.
