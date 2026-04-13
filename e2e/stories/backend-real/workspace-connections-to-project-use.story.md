---
{
  "storyId": "workspace-connections-to-project-use",
  "title": "Workspace connections to project use",
  "actor": "workspace admin / project member",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/connections",
  "goal": "成员在工作区连接页确认共享集成状态后，能够清楚地继续到项目使用的项目列表并打开 use-guide，最后真的完成第一次 endpoint 消费，而不是把连接页当成一个停住不动的设置页。",
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
      "model": "story-workspace-connections-model",
      "apiKeyLabelPrefix": "Story Workspace Connections API Key",
      "apiKeyTtlDays": "7",
      "consumeProtocol": "anthropic",
      "expectedReplyText": "WORKSPACE_CONNECTIONS_READY"
    }
  },
  "narrative": "Workspace connections should not be a dead-end settings page; after checking that the workspace integration is ready, the member should have a clear project-use handoff, see the use-guide, and complete one real endpoint call.",
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
      "sceneId": "project-use-guide",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/use-guide",
      "stableMarkers": [
        "use-guide__page",
        "use-guide__endpoint-select"
      ]
    },
    {
      "sceneId": "personal-api-keys",
      "route": "/en-US/user/api-keys",
      "stableMarkers": [
        "api-keys__create-btn"
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
    },
    {
      "stepId": "create-personal-api-key",
      "sceneId": "personal-api-keys",
      "intent": "Create a personal API key needed for the first real consumption.",
      "action": "Create personal API key",
      "target": "api-keys__create-btn",
      "expectedFeedback": "用户完成自助创建 API key。",
      "note": "个人 API key 让成员真正能完成第一次 project consumption。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "consume-project-endpoint",
      "sceneId": "project-use-guide",
      "intent": "Use the personal API key to call the project endpoint through the documented gateway base URL.",
      "action": "Consume project endpoint",
      "target": "use-guide__gateway-base-url",
      "expectedFeedback": "成员能按照 use-guide 成功完成第一次 endpoint 消费。",
      "note": "workspace connections 的 handoff 必须真的把成员带到一次成功调用，而不是只停在链接页。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-first-consumption",
      "sceneId": "project-use-guide",
      "intent": "Confirm the first real consumption returns the expected response.",
      "action": "Verify first consumption",
      "target": "use-guide__gateway-base-url",
      "expectedFeedback": "第一次消费返回预期结果，说明 workspace connections 真的把人带到了可用的 project use。",
      "note": "最终判断应该落在真实消费返回，而不是页面文本。",
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
