---
{
  "storyId": "resource-policy-change-to-observable-effect",
  "title": "Resource policy change to observable effect",
  "actor": "project owner / joined member",
  "family": "resource-policy-observable-effect",
  "personas": [
    "project owner",
    "joined member"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/ws_default/projects",
  "goal": "项目 owner 修改 resource policy 之后，页面上的 effective access / effective summary / explainability 与成员实际可用能力都必须一起变化，而不是只保存一条配置记录。",
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
    "resourcePolicyObservable": {
      "projectNamePrefix": "Resource Policy Observable",
      "memberEmail": "integration-member@example.com",
      "credentialNamePrefix": "Resource Policy Credential",
      "endpointNamePrefix": "Resource Policy Endpoint",
      "allowedTokenPrefix": "RESOURCE_POLICY_ALLOWED"
    }
  },
  "narrative": "project owner 调整资源策略时，用户真正需要的是看懂当前 endpoint 对谁开放、为什么开放，以及成员马上还能不能继续用。effective summary、explainability 和真实 endpoint 使用结果必须讲同一件事。",
  "scenes": [
    {
      "sceneId": "resource-policy",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/resource-policy",
      "stableMarkers": [
        "resource-policy__editor",
        "resource-policy__effective-summary",
        "resource-policy__explainability"
      ]
    },
    {
      "sceneId": "project-members",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/members",
      "stableMarkers": [
        "members__table"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "baseline-member-can-use-endpoint",
      "sceneId": "resource-policy",
      "intent": "Confirm the member can use the project endpoint before any policy tightening happens.",
      "action": "Confirm baseline endpoint use",
      "target": "resource-policy__effective-summary",
      "expectedFeedback": "在默认 allow-all 状态下，member explainability 显示 allowed，并且真实 endpoint 调用成功。",
      "note": "先建立 policy 收紧前的正常可用基线。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "tighten-policy-and-explain-deny",
      "sceneId": "resource-policy",
      "intent": "Tighten the allow list and verify explainability now tells the owner the member will be denied.",
      "action": "Tighten policy and explain deny",
      "target": "resource-policy__explain-result",
      "expectedFeedback": "owner 保存 allow_list 后，effective summary 和 explainability 都明确显示该成员不再被允许。",
      "note": "owner 应该先在治理页里看懂 deny 真相，再去观察真实使用效果。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "member-hit-policy-denial",
      "sceneId": "resource-policy",
      "intent": "Verify the member now receives a real policy denial on endpoint use.",
      "action": "Observe member policy denial",
      "target": "resource-policy__matched-policy",
      "expectedFeedback": "同一个 endpoint 在 explainability 说 deny 之后，member 的真实调用必须返回 policy denial，而不是继续成功。",
      "note": "要证明 resource policy 的 effect 不只是 UI 上的说明文字。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "reopen-policy-and-restore-use",
      "sceneId": "resource-policy",
      "intent": "Allow the member again and verify both explainability and real endpoint use recover.",
      "action": "Restore member access and endpoint use",
      "target": "resource-policy__explain-result",
      "expectedFeedback": "owner 把成员重新加入 allow_list 之后，explainability 回到 allowed，member 的真实 endpoint 使用也恢复成功。",
      "note": "最后一跳必须把治理变化和实际工作可用性重新对齐。",
      "evidence": [
        "trace"
      ]
    }
  ]
}
---
Canonical backend-real story for resource policy change leading to observable effect.
