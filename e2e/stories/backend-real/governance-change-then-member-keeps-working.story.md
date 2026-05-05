---
{
  "storyId": "governance-change-then-member-keeps-working",
  "title": "Governance change then member keeps working",
  "actor": "project owner / joined member",
  "family": "project-governance-runtime-change",
  "personas": [
    "project owner",
    "joined member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects",
  "goal": "项目成员在治理变更之后，chat、Agent Task detail artifacts continuity 的真实可用状态必须立刻跟着变化：普通成员继续完成自己的 chat 和 Agent Task 任务，并在 Agent Task detail 中继续看到自己任务产物；升权后在继续工作的同时获得新的治理能力；降权后继续工作但失去这些额外能力；被移除后则不再继续看到旧项目。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": [
    {
      "dependencyId": "integration-keycloak-users",
      "kind": "integration",
      "required": true,
      "note": "backend-real governance stories need integration Keycloak users to exercise real membership and policy changes."
    }
  ],
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is available",
    "integration Keycloak users are available",
    "backend-real endpoint credential is available"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "governanceRuntimeWork": {
      "projectNamePrefix": "Governance Runtime Work",
      "memberEmail": "integration-member@example.com",
      "memberDisplayName": "Integration Member",
      "credentialNamePrefix": "Governance Runtime Credential",
      "endpointNamePrefix": "Governance Runtime Endpoint",
      "chatAgentTitlePrefix": "Governance Runtime Chat Agent",
      "agentTaskRunnerTitlePrefix": "Governance Runtime Agent Task Agent",
      "taskWorkspacePrefix": "Governance Runtime Workspace",
      "agentTaskTitlePrefix": "Governance Runtime Task",
      "chatTokenPrefix": "GOV_RUNTIME_CHAT",
      "agentTaskTokenPrefix": "GOV_RUNTIME_AGENT_TASK",
      "artifactNamePrefix": "governance-runtime-artifact"
    }
  },
  "narrative": "从成员视角看，真正重要的不是 owner 改了一个组，而是自己还能不能继续做原来的工作：先正常使用项目里的 chat、Agent Task，并在 Agent Task detail 中继续看到自己任务 workspace 里的 .artifacts；如果被升权，继续工作之外还能真实管理项目治理入口；如果被降权，又应该回到普通成员的工作能力；如果被移除，就不应该靠旧缓存继续进入项目。",
  "scenes": [
    {
      "sceneId": "project-chat",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/chat",
      "stableMarkers": [
        "chat__main-pane"
      ]
    },
    {
      "sceneId": "project-agent-tasks",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks",
      "stableMarkers": [
        "agent-tasks__task-list"
      ]
    },
    {
      "sceneId": "project-agent-task",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks/{taskId}",
      "stableMarkers": [
        "agent-task__task-header",
        "agent-tasks__artifact-card"
      ]
    },
    {
      "sceneId": "project-settings",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/settings",
      "stableMarkers": [
        "settings__project-admins-save"
      ]
    },
    {
      "sceneId": "project-overview",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/overview",
      "stableMarkers": [
        "project-overview__page"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "member-first-success",
      "sceneId": "project-agent-task",
      "intent": "Join the project and complete the first normal member work cycle.",
      "action": "Complete first member work cycle",
      "target": "agent-tasks__artifact-card",
      "expectedFeedback": "成员接受邀请后，应该能正常完成 chat、Agent Task，并在 Agent Task detail 中继续看到自己任务 workspace 的 .artifacts，而不是只拿到一个 effective access 抽屉结果。",
      "note": "先确认普通成员视角下的真实工作能力已经成立，包括 Agent Task detail 的 artifact continuity。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "promote-member-and-continue-work",
      "sceneId": "project-settings",
      "intent": "Promote the member and verify work continues while governance ability expands.",
      "action": "Promote member and continue work",
      "target": "settings__project-admins-save",
      "expectedFeedback": "成员升权后，chat、Agent Task 和 Agent Task detail 中的 artifact continuity 继续可用，并且项目治理设置入口真实可见。",
      "note": "升权既要保住工作连续性，也要让新治理能力立即变成可见可用状态。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "demote-member-and-continue-work",
      "sceneId": "project-agent-task",
      "intent": "Demote the member and verify work still continues but governance ability disappears.",
      "action": "Demote member and continue work",
      "target": "agent-tasks__artifact-card",
      "expectedFeedback": "成员降权后，核心工作流与 Agent Task detail 中的 artifact continuity 继续可用，但项目治理设置不再可见或不再可操作。",
      "note": "降权不该打断正常成员工作，但必须及时收回治理能力。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "remove-member-and-lose-project-access",
      "sceneId": "project-overview",
      "intent": "Remove the member and verify the project no longer remains reachable in a fresh session.",
      "action": "Remove member and verify loss of access",
      "target": "project-overview__page",
      "expectedFeedback": "成员被移除后，在 fresh workspace-specific login 里不应再看到该项目；直接访问 chat、Agent Task、task detail 等 project URL 时，应进入 Project unavailable，而不是被带去泛化 workspace selector 或继续看到旧页面。",
      "note": "最终要证明 removed member 不会靠旧缓存继续工作。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for governance change followed by continued member work.
