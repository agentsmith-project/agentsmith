---
{
  "storyId": "project-owner-daily-governance-review",
  "title": "Project owner daily governance review",
  "actor": "system 管理侧 / project owner",
  "family": "project-owner-daily-governance-review",
  "personas": [
    "system 管理侧",
    "project owner"
  ],
  "kind": "journey",
  "lane": "backend-real",
  "entryRoute": "/en-US/workspaces/{workspaceId}/projects/{projectId}/usage",
  "goal": "project owner 能在进入项目后看懂项目现在运行如何，并根据 usage、audit 与 alerts 的连续信号判断要不要处理，以及下一步是否需要把监控交给 alerts follow-up surface。",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "preconditions": [
    "backend-real stack is ready",
    "system 管理侧与 project owner 账户可用",
    "system 管理侧可创建并发布工作区",
    "project owner 可以创建项目凭据与 endpoints",
    "backend-real provider credential is available for generating real usage"
  ],
  "runtimeData": {
    "governanceReview": {
      "projectNamePrefix": "Owner Governance Review",
      "credentialNamePrefix": "Owner Governance Credential",
      "endpointNamePrefix": "Owner Governance Endpoint",
      "alertRuleNamePrefix": "Owner Governance Alert",
      "model": "story-governance-review-model",
      "expectedReplyText": "OWNER_GOVERNANCE_REVIEW_OK",
      "threshold": 1
    }
  },
  "narrative": "这条治理巡检故事不是让 system admin 顺手看一眼 usage，而是 system 管理侧先开通工作区，再交给 project owner 作为普通用户进入项目，用真实 provider 请求制造运行信号，连续回答三个问题：项目现在是否真的在运行、最近发生了什么、需不需要交给 alerts 持续监控。",
  "scenes": [
    {
      "sceneId": "project-usage",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/usage",
      "stableMarkers": [
        "usage__work-surface",
        "usage__summary-line",
        "usage__selected-endpoint"
      ]
    },
    {
      "sceneId": "project-audit",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/audit",
      "stableMarkers": [
        "audit__page",
        "audit__work-surface",
        "audit__table-region"
      ]
    },
    {
      "sceneId": "project-alerts",
      "route": "/en-US/workspaces/{workspaceId}/projects/{projectId}/alerts",
      "stableMarkers": [
        "alerts__main-surface",
        "alert-center-page",
        "alerts__tab__rules"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-usage-review",
      "sceneId": "project-usage",
      "intent": "Open the governance review from the usage surface after the project owner enters the project.",
      "action": "Open usage review",
      "target": "usage__work-surface",
      "expectedFeedback": "owner 看到项目 usage 工作面并开始 review。",
      "note": "日常巡检首先要回答项目现在是否真的在运行，而不是先看配置列表。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "inspect-runtime-usage",
      "sceneId": "project-usage",
      "intent": "Inspect whether endpoint traffic and limits show real project activity.",
      "action": "Inspect runtime usage",
      "target": "usage__selected-endpoint",
      "expectedFeedback": "owner 能确认 endpoint 已经产生请求信号。",
      "note": "usage review 要服务于是否需要继续追查，而不是只展示一组静态指标。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "inspect-audit-detail",
      "sceneId": "project-audit",
      "intent": "Inspect a recent audit event to understand what changed around the project runtime.",
      "action": "Inspect audit detail",
      "target": "audit__detail-summary",
      "expectedFeedback": "owner 能看到最近一次相关事件的细节摘要。",
      "note": "audit detail 应该回答最近发生了什么，而不是迫使 owner 在表格里自己拼上下文。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "configure-alert-follow-up",
      "sceneId": "project-alerts",
      "intent": "Prepare a follow-up alert rule so the owner can hand off continuous monitoring to the system.",
      "action": "Configure alert follow-up",
      "target": "alert-rules-list__surface",
      "expectedFeedback": "owner 已进入 alerts follow-up surface，并看到当前真实后端下是否已有持久化规则；如果还没有，也能明确知道下一步入口。",
      "note": "治理巡检的收尾仍然是把后续监控交给 alerts，但 real lane 只能验证真实后端当前能返回的 follow-up 状态，不伪造不存在的规则持久化。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "externalDependencies": [
    {
      "dependencyId": "provider-api-key",
      "kind": "credential",
      "required": true,
      "note": "backend-real governance review needs a runnable provider credential to generate real usage before review."
    }
  ]
}
---
Canonical backend-real story for a project owner's daily governance review across usage, audit, and alerts.
