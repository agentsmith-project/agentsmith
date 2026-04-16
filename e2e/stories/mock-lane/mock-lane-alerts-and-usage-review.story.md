---
{
  "storyId": "mock-lane-alerts-and-usage-review",
  "title": "Mock lane alerts and usage review scenes",
  "actor": "project owner / project admin",
  "lane": "mock-lane",
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/alerts",
  "goal": "统一描述项目 owner 日常查看 alerts、usage 与 audit 信号时的 mock-lane visual scene 真相。",
  "narrative": "Monitoring scenes cover the alerts center, usage drill-down, and audit follow-up surfaces a project owner uses to review AI activity without leaving the governance flow.",
  "scenes": [
    {
      "sceneId": "alerts",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/alerts",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": [
        "alerts__main-surface",
        "alert-center-page",
        "alert-center__summary-meta",
        "alerts__open-audit",
        "alerts__open-usage"
      ]
    },
    {
      "sceneId": "alerts-notifications-tab",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/alerts",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": [
        "alerts__main-surface",
        "alert-center-page",
        "alert-center__summary-meta",
        "alerts__tab__notifications"
      ]
    },
    {
      "sceneId": "alerts-rules-tab",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/alerts",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": [
        "alerts__main-surface",
        "alert-center-page",
        "alert-center__summary-meta",
        "alerts__tab__rules",
        "alert-rules-list__surface"
      ]
    },
    {
      "sceneId": "alerts-rule-create-dialog",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/alerts",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": [
        "alerts__main-surface",
        "alert-center-page",
        "alert-center__summary-meta",
        "alerts__tab__rules",
        "alert-center__create-button"
      ]
    },
    {
      "sceneId": "usage",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/usage",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": [
        "usage__work-surface",
        "usage__summary-line",
        "usage__selected-endpoint",
        "usage__limits"
      ]
    },
    {
      "sceneId": "usage-endpoint-switch",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/usage",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": [
        "usage__work-surface",
        "usage__summary-line",
        "usage__selected-endpoint",
        "usage__limits"
      ]
    },
    {
      "sceneId": "audit",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/audit",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": [
        "audit__page",
        "audit__work-surface",
        "audit__table"
      ]
    },
    {
      "sceneId": "audit-empty-state",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/audit?resource_id=__visual_empty__",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": [
        "audit-usage__empty-state"
      ]
    },
    {
      "sceneId": "drawer-audit-detail",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/audit",
      "recipeFamily": "overlay_sheet",
      "authLane": "authed",
      "stableMarkers": [
        "audit__detail-summary"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-alerts-review",
      "sceneId": "alerts",
      "intent": "Open the alerts review surface for a project owner.",
      "action": "Open alerts",
      "target": "alerts__main-surface",
      "expectedFeedback": "alerts 汇总面可见，并暴露 usage 和 audit follow-up。",
      "note": "监控面应把提醒、用量和审计串成一条低心智负担的 review 线。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-usage-review",
      "sceneId": "usage",
      "intent": "Open the usage drill-down surface for the selected endpoint.",
      "action": "Open usage",
      "target": "usage__selected-endpoint",
      "expectedFeedback": "当前 endpoint 的 usage 面可见。",
      "note": "usage 面应保持单一治理工作面，而不是重新退回 dashboard 卡片。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "alerts",
          "scenarioId": "alerts",
          "scenario": "Project alerts surface.",
          "group": "project_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/alerts/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "alerts-notifications-tab",
          "scenarioId": "alerts-notifications-tab",
          "scenario": "Alerts page switched to notifications tab.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/alerts/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "alerts-rules-tab",
          "scenarioId": "alerts-rules-tab",
          "scenario": "Alerts page switched to rules tab.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/alerts/AlertCenterPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "alerts-rule-create-dialog",
          "scenarioId": "alerts-rule-create-dialog",
          "scenario": "Alert rule create dialog opened from the rules surface.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/alerts/AlertCenterPage.tsx",
            "src/components/alerts/AlertRuleFormDialog.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "usage",
          "scenarioId": "usage",
          "scenario": "Project usage page with the resolved endpoint scope.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/audit-usage/UsagePage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "usage-endpoint-switch",
          "scenarioId": "usage-endpoint-switch",
          "scenario": "Usage page focused on the resolved endpoint scope.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/audit-usage/UsagePage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "audit",
          "scenarioId": "audit",
          "scenario": "Project audit page.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/audit-usage/AuditPageContent.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "audit-empty-state",
          "scenarioId": "audit-empty-state",
          "scenario": "Audit page empty-state variant.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/audit-usage/AuditPageContent.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "drawer-audit-detail",
          "scenarioId": "drawer-audit-detail",
          "scenario": "Audit detail drawer.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/audit-usage/AuditPageContent.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        }
      ]
    }
  },
  "family": "mock-lane-alerts-and-usage-review",
  "personas": [
    "project owner",
    "project admin"
  ],
  "kind": "journey",
  "gatePolicy": {
    "tier": "default",
    "requiredEvidence": [
      "trace"
    ]
  },
  "externalDependencies": []
}
---
Mock lane alerts/usage/audit review family source.
