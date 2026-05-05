---
{
  "storyId": "project-governance-runtime-setup",
  "title": "Project governance runtime setup",
  "actor": "project owner / member",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects",
  "goal": "project owner can configure credentials, endpoints, and Agent Runners; members can use Agent Runners but cannot manage them.",
  "preconditions": [
    "backend-real stack is ready",
    "workspace ws_default is available",
    "project creator access is configured"
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
  "narrative": "runtime setup should feel like a governed project configuration flow: first prepare credentials and endpoints, then establish Agent Runners, and finally validate member-only usage vs manage permissions.",
  "scenes": [
    {
      "sceneId": "project-credentials",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/credentials",
      "stableMarkers": [
        "credentials__create-btn"
      ]
    },
    {
      "sceneId": "project-endpoints",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/endpoints",
      "stableMarkers": [
        "endpoints__create-btn"
      ]
    },
    {
      "sceneId": "project-agent-runners",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-runners",
      "stableMarkers": [
        "agent-runners__create-btn"
      ]
    },
    {
      "sceneId": "project-agent-tasks",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/agent-tasks",
      "stableMarkers": [
        "agent-tasks__task-list",
        "agent-tasks__create-task-btn"
      ]
    },
    {
      "sceneId": "project-members",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/members",
      "stableMarkers": [
        "members__search-input"
      ]
    }
  ],
  "runtimeData": {
    "endpointFlows": {
      "custom": {
        "namePrefix": "Responses Custom",
        "upstreamProtocol": "openai_responses",
        "baseUrl": "https://responses.provider.example/v1",
        "model": "responses-model"
      },
      "catalog": {
        "namePrefix": "Catalog Anthropic",
        "upstreamProtocol": "anthropic_messages",
        "baseUrl": "https://api.anthropic.com/v1",
        "model": "claude-sonnet-catalog"
      }
    },
    "agentSetup": {
      "credentialNamePrefix": "Project Governance Credential",
      "endpointNamePrefix": "Agent Permissions Endpoint",
      "agentTaskRunnerTitlePrefix": "Agent Permissions",
      "memberTaskTitlePrefix": "Agent Member Task"
    }
  },
  "steps": [
    {
      "stepId": "credentials-list",
      "sceneId": "project-credentials",
      "intent": "Inspect project credentials.",
      "action": "Review credentials",
      "target": "credentials__create-btn",
      "expectedFeedback": "项目凭据已就绪",
      "note": "项目凭据已就绪",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "endpoint-custom-created",
      "sceneId": "project-endpoints",
      "intent": "Create a custom endpoint with the responses protocol and then edit it.",
      "action": "Create custom endpoint",
      "target": "endpoints__create-btn",
      "expectedFeedback": "custom endpoint 的创建与编辑 UX 保持一致",
      "note": "custom endpoint 的创建与编辑 UX 保持一致",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "endpoint-catalog-edited",
      "sceneId": "project-endpoints",
      "intent": "Edit a catalog endpoint and keep catalog-specific fields.",
      "action": "Edit catalog endpoint",
      "target": "endpoints__table__row",
      "expectedFeedback": "catalog endpoint 的编辑 UX 保持 catalog 语义",
      "note": "catalog endpoint 的编辑 UX 保持 catalog 语义",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "agent-runners-created",
      "sceneId": "project-agent-runners",
      "intent": "Create Agent Runners that will be used by project members.",
      "action": "Create Agent Runners",
      "target": "agent-runners__create-btn",
      "expectedFeedback": "Agent Runner 已创建且可供普通成员使用",
      "note": "Agent Runner 已创建且可供普通成员使用",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "member-task-created",
      "sceneId": "project-agent-tasks",
      "intent": "Create a Agent Task as a member and run it through the prepared agent setup.",
      "action": "Create member Agent Task",
      "target": "agent-tasks__create-task-btn",
      "expectedFeedback": "member 能创建任务并收到 Agent Task 响应",
      "note": "member 能创建任务并收到 Agent Task 响应",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "member-manage-forbidden",
      "sceneId": "project-members",
      "intent": "Confirm members can use Agent Runners but cannot manage them.",
      "action": "Verify member manage permissions",
      "target": "members__search-input",
      "expectedFeedback": "member 对管理接口保持 403",
      "note": "member 对管理接口保持 403",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "project-governance-runtime-setup",
  "personas": [
    "project owner",
    "member"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for project governance runtime setup.
