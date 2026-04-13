---
{
  "storyId": "usage-self-scope-review",
  "title": "Usage self scope review",
  "actor": "project member",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/usage",
  "goal": "\u9879\u76ee\u6210\u5458\u5728\u53d1\u8d77\u4e00\u6b21\u771f\u5b9e\u8bf7\u6c42\u540e\uff0c\u53ef\u4ee5\u6253\u5f00\u6211\u7684\u7528\u91cf\u5e76\u770b\u61c2\u8fd9\u91cc\u53ea\u663e\u793a\u81ea\u5df1\u7684 usage\uff0c\u800c\u4e0d\u662f\u9879\u76ee\u6cbb\u7406\u603b\u89c8\u3002",
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
    "usageSelfScope": {
      "projectNamePrefix": "Usage Self Scope Story",
      "credentialNamePrefix": "Usage Self Scope Credential",
      "endpointNamePrefix": "Usage Self Scope Endpoint",
      "model": "usage-self-scope-model",
      "expectedReplyText": "USAGE_SELF_SCOPE_OK"
    }
  },
  "narrative": "\u666e\u901a\u6210\u5458\u771f\u6b63\u5173\u5fc3\u7684\u662f\uff1a\u6211\u521a\u521a\u7528\u8fc7\u9879\u76ee endpoint\uff0c\u73b0\u5728\u56de\u5230\u6211\u7684\u7528\u91cf\u65f6\uff0c\u80fd\u4e0d\u80fd\u76f4\u63a5\u770b\u61c2\u8fd9\u662f\u6211\u81ea\u5df1\u7684\u8bf7\u6c42\u548c\u9650\u5236\u6d88\u8017\uff0c\u800c\u4e0d\u662f owner \u7684\u9879\u76ee\u6cbb\u7406\u53f0\u3002",
  "scenes": [
    {
      "sceneId": "project-usage-self",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/usage",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": [
        "usage__view",
        "usage__my-scope-badge",
        "usage__summary-line",
        "usage__work-surface"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "generate-self-usage",
      "intent": "Generate one real usage event as the current member before opening the review page.",
      "action": "Generate personal endpoint usage",
      "target": "endpoint proxy request",
      "expectedFeedback": "\u5f53\u524d\u6210\u5458\u5148\u6709\u4e00\u6761\u771f\u5b9e\u8bf7\u6c42\uff0c\u540e\u7eed\u6211\u7684\u7528\u91cf\u9875\u9762\u624d\u6709\u53ef\u7406\u89e3\u7684\u4e2a\u4eba\u6d88\u8017\u4fe1\u53f7\u3002",
      "note": "\u8fd9\u4e00\u6b65\u662f\u6210\u5458\u771f\u5b9e\u4f7f\u7528\u9879\u76ee endpoint\uff0c\u4e0d\u662f owner \u6cbb\u7406\u52a8\u4f5c\u3002",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-usage-review",
      "sceneId": "project-usage-self",
      "intent": "Open the usage page after making one real request.",
      "action": "Open my usage",
      "target": "usage__view",
      "expectedFeedback": "\u6210\u5458\u8fdb\u5165 Usage \u9875\u9762\uff0c\u5e76\u770b\u5230\u7a33\u5b9a\u7684\u4e2a\u4eba\u7528\u91cf\u5de5\u4f5c\u9762\u3002",
      "note": "\u5165\u53e3\u5fc5\u987b\u76f4\u63a5\u628a\u6210\u5458\u5e26\u5230\u6211\u7684\u7528\u91cf\uff0c\u4e0d\u8981\u6df7\u5165\u6cbb\u7406\u53f0\u8bed\u4e49\u3002",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "review-self-scope-summary",
      "sceneId": "project-usage-self",
      "intent": "Confirm that the page clearly states the scope is only the current member's usage.",
      "action": "Review self scope summary",
      "target": "usage__my-scope-badge",
      "expectedFeedback": "\u9875\u9762\u660e\u786e\u8bf4\u660e\u8fd9\u91cc\u53ea\u770b\u6211\u81ea\u5df1\u5728\u5f53\u524d\u9879\u76ee\u91cc\u7684 usage\uff0c\u4e0d\u662f\u9879\u76ee\u6cbb\u7406\u603b\u89c8\u3002",
      "note": "\u6210\u5458\u9996\u5148\u9700\u8981\u770b\u61c2\u8303\u56f4\u8fb9\u754c\uff0c\u907f\u514d\u628a Usage \u8bef\u89e3\u6210 owner \u5ba1\u8ba1\u53f0\u3002",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "review-endpoint-usage",
      "sceneId": "project-usage-self",
      "intent": "Review the endpoint and limit signals for the member's own recent request.",
      "action": "Review endpoint usage",
      "target": "usage__selected-endpoint",
      "expectedFeedback": "\u6210\u5458\u80fd\u628a\u521a\u521a\u7528\u8fc7\u7684 endpoint \u548c\u5f53\u524d\u9650\u5236\u6d88\u8017\u8054\u7cfb\u8d77\u6765\uff0c\u5e76\u7ee7\u7eed\u7406\u89e3\u81ea\u5df1\u7684 30 \u5929 usage\u3002",
      "note": "Usage \u9700\u8981\u4fdd\u6301\u4f4e\u5fc3\u667a\u7684\u4e2a\u4eba\u89c6\u56fe\uff1aendpoint\u3001limits\u3001trend\uff0c\u800c\u4e0d\u662f\u6cbb\u7406\u52a8\u4f5c\u96c6\u5408\u3002",
      "evidence": [
        "trace"
      ]
    }
  ],
  "family": "usage-self-scope-review",
  "personas": [
    "project member"
  ],
  "kind": "journey",
  "externalDependencies": []
}
---
Canonical backend-real story for a project member reviewing personal usage after one real request.
