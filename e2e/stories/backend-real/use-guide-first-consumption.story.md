---
{
  "storyId": "use-guide-first-consumption",
  "title": "Use guide first consumption",
  "actor": "project member",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/use-guide",
  "goal": "项目成员第一次进入 use-guide 时，应该能先看懂项目的可用入口，再创建自己的 API key，最后完成第一次正确消费，而且能清楚看到 workspace personal context entries 的准备状态，而不是把 use-guide 当成一个静态说明页。",
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
    "useGuideFirstConsumption": {
      "projectNamePrefix": "Story Use Guide",
      "endpointNamePrefix": "Story Use Guide Endpoint",
      "credentialNamePrefix": "Story Use Guide Credential",
      "apiKeyLabelPrefix": "Story Use Guide API Key",
      "apiKeyTtlDays": "7",
      "model": "story-use-guide-model",
      "consumeProtocol": "anthropic",
      "expectedReplyText": "USE_GUIDE_FIRST_CONSUMPTION_OK"
    }
  },
  "narrative": "use-guide 的核心不是文档感，而是把成员带到第一次可以真实消费项目 endpoint 的位置：先看懂入口，再创建个人 API key，再完成第一次成功调用，并且能看见 workspace personal context entries 的 readiness。",
  "scenes": [
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
    },
    {
      "sceneId": "project-endpoints",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/endpoints",
      "stableMarkers": [
        "endpoints__table",
        "endpoints__create-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-use-guide",
      "sceneId": "project-use-guide",
      "intent": "Open the canonical project use guide and confirm it explains the project entry path.",
      "action": "Open use guide",
      "target": "use-guide__page",
      "expectedFeedback": "成员先看懂 use-guide，而不是直接被丢进接口细节。",
      "note": "use-guide 必须先承接用户理解，再承接第一次消费。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "verify-use-guide-readiness",
      "sceneId": "project-use-guide",
      "intent": "Confirm workspace personal context entries are visible before the first call.",
      "action": "Verify use guide readiness",
      "target": "use-guide__status-context",
      "expectedFeedback": "成员能看见 workspace personal context entries 的 readiness。",
      "note": "use-guide 不是静态说明页，它必须清楚讲出当前项目的 readiness。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "choose-first-usable-endpoint",
      "sceneId": "project-use-guide",
      "intent": "Choose the first usable endpoint and keep the guide anchored on a real project entry.",
      "action": "Choose first usable endpoint",
      "target": "use-guide__endpoint-select",
      "expectedFeedback": "成员能从 use-guide 看到并选择一个真正可用的 endpoint。",
      "note": "第一条可用 endpoint 是第一次消费的起点。",
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
      "note": "个人 API key 是 first consumption 的一部分，不是治理对象。",
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
      "note": "use-guide 的目标是把用户带到可成功消费的位置。",
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
      "expectedFeedback": "第一次消费返回预期结果，说明 use-guide 不是静态说明页。",
      "note": "验证结果比页面文本更重要。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "use-guide-first-consumption",
  "personas": [
    "project member"
  ],
  "kind": "journey"
}
---
Canonical backend-real story for first use-guide consumption.
