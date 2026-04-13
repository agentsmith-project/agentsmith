---
{
  "storyId": "api-key-to-endpoint-consumption",
  "title": "API key to endpoint consumption",
  "actor": "project member",
  "lane": "backend-real",
  "entryRoute": "/en-US/user/api-keys",
  "goal": "项目成员创建自己的 API key 后，可以按 Use Guide 调用项目 endpoint，而不需要管理凭据或 endpoint 配置。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "Keycloak is configured"
  ],
  "seedData": [
    "ws_default"
  ],
  "runtimeData": {
    "apiKeyEndpointConsumption": {
      "projectName": "Story API Key Consumption",
      "endpointName": "Story Anthropic Gateway Endpoint",
      "credentialName": "Story Endpoint Credential",
      "apiKeyLabel": "Story Personal API Key",
      "apiKeyTtlDays": "7",
      "model": "story-gateway-model",
      "consumeProtocol": "anthropic",
      "expectedReplyText": "API_KEY_ENDPOINT_OK"
    }
  },
  "narrative": "成员的常见目标是按项目 use guide 拿到可调用入口，再用自己的 API key 发起请求；真正关心的是能否消费 endpoint，而不是 endpoint 配置细节。",
  "scenes": [
    {
      "sceneId": "user-api-keys",
      "route": "/en-US/user/api-keys",
      "stableMarkers": [
        "api-keys__create-btn"
      ]
    },
    {
      "sceneId": "project-use-guide",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/use-guide",
      "stableMarkers": [
        "use-guide__page"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "review-use-guide",
      "sceneId": "project-use-guide",
      "intent": "Review the endpoint access guide as a project member.",
      "action": "Review endpoint guide",
      "target": "use-guide__page",
      "expectedFeedback": "成员能看到 endpoint 的 canonical base URL 和协议说明",
      "note": "成员能看到 endpoint 的 canonical base URL 和协议说明",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "create-personal-api-key",
      "sceneId": "user-api-keys",
      "intent": "Create a personal API key for endpoint access.",
      "action": "Create personal API key",
      "target": "api-keys__create-btn",
      "expectedFeedback": "用户自助创建 API key 成功并拿到一次性显示的 key",
      "note": "用户自助创建 API key 成功并拿到一次性显示的 key",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "consume-endpoint",
      "sceneId": "project-use-guide",
      "intent": "Use the personal API key against the project endpoint through the current endpoint's supported protocol.",
      "action": "Consume endpoint",
      "target": "use-guide__page",
      "expectedFeedback": "personal API key 可以按当前 endpoint 的 canonical protocol 成功调用项目 endpoint",
      "note": "personal API key 可以按当前 endpoint 的 canonical protocol 成功调用项目 endpoint",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "api-key-to-endpoint-consumption",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for personal API key endpoint consumption.
