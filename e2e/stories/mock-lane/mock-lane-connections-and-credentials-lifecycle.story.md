---
{
  "storyId": "mock-lane-connections-and-credentials-lifecycle",
  "title": "Mock lane connections and credentials lifecycle scenes",
  "actor": "workspace member / workspace admin / project owner",
  "lane": "mock-lane",
  "entryRoute": "/en-US/user/third-party-accounts",
  "goal": "统一描述个人连接、工作区集成状态和项目凭据生命周期的 mock-lane visual scene 真相。",
  "narrative": "Lifecycle scenes cover personal third-party accounts, workspace Feishu connection states, and project credential management surfaces so credential setup can be reviewed as one user-visible capability chain.",
  "scenes": [
    {
      "sceneId": "third-party-accounts",
      "route": "/en-US/user/third-party-accounts",
      "recipeFamily": "settings_sheet",
      "authLane": "mock_auth",
      "stableMarkers": [
        "third-party-accounts__list-section",
        "third-party-accounts__create-btn"
      ]
    },
    {
      "sceneId": "third-party-accounts-create-sheet",
      "route": "/en-US/user/third-party-accounts",
      "recipeFamily": "overlay_sheet",
      "authLane": "mock_auth",
      "stableMarkers": [
        "third-party-accounts__sheet"
      ]
    },
    {
      "sceneId": "third-party-accounts-edit-sheet",
      "route": "/en-US/user/third-party-accounts",
      "recipeFamily": "overlay_sheet",
      "authLane": "mock_auth",
      "stableMarkers": [
        "third-party-accounts__sheet"
      ]
    },
    {
      "sceneId": "workspace-settings-feishu-enabled",
      "route": "/en-US/workspaces/ws_default/settings",
      "recipeFamily": "settings_sheet",
      "authLane": "authed",
      "stableMarkers": [
        "ws-settings__integration-feishu"
      ]
    },
    {
      "sceneId": "workspace-feishu-setup-credentials",
      "route": "/en-US/workspaces/ws_default/settings/feishu?step=credentials",
      "recipeFamily": "settings_sheet",
      "authLane": "authed",
      "stableMarkers": [
        "ws-feishu__save-draft"
      ]
    },
    {
      "sceneId": "workspace-feishu-locked",
      "route": "/en-US/workspaces/ws_default/settings/feishu",
      "recipeFamily": "settings_sheet",
      "authLane": "authed",
      "stableMarkers": [
        "ws-feishu__locked"
      ]
    },
    {
      "sceneId": "workspace-connections-feishu-disabled",
      "route": "/en-US/workspaces/ws_default/connections",
      "recipeFamily": "settings_sheet",
      "authLane": "authed",
      "stableMarkers": [
        "workspace-connections__feishu-connect",
        "workspace-connections__capability-note",
        "workspace-connections__personal-state"
      ]
    },
    {
      "sceneId": "workspace-connections-feishu-connected",
      "route": "/en-US/workspaces/ws_default/connections",
      "recipeFamily": "settings_sheet",
      "authLane": "authed",
      "stableMarkers": [
        "workspace-connections__feishu-connect",
        "workspace-connections__capability-note",
        "workspace-connections__personal-state"
      ]
    },
    {
      "sceneId": "credentials",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/credentials",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": [
        "credentials__create-btn",
        "credentials__capability-note",
        "credentials__summary-count"
      ]
    },
    {
      "sceneId": "dialog-create-credential",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/credentials",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": [
        "credentials__create-dialog"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-personal-connections",
      "sceneId": "third-party-accounts",
      "intent": "Open the personal third-party connections page.",
      "action": "Open personal connections",
      "target": "third-party-accounts__list-section",
      "expectedFeedback": "个人第三方连接清单可见。",
      "note": "个人连接页应保持 settings_sheet recipe，而不是回到 dashboard 总览。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-workspace-connections",
      "sceneId": "workspace-connections-feishu-connected",
      "intent": "Open the workspace connections page after integration setup.",
      "action": "Open workspace connections",
      "target": "workspace-connections__workspace-state",
      "expectedFeedback": "工作区连接状态可见。",
      "note": "工作区集成状态应与个人连接和项目凭据形成连续 lifecycle，而不是分散在无关联页面里。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-project-credentials",
      "sceneId": "credentials",
      "intent": "Open the project credentials page.",
      "action": "Open project credentials",
      "target": "credentials__table",
      "expectedFeedback": "项目凭据清单可见。",
      "note": "项目凭据面应继续作为治理表面，而不是孤立的弹窗入口。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "third-party-accounts",
          "scenarioId": "third-party-accounts",
          "scenario": "Third-party account connections page.",
          "group": "user_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/user/third-party-accounts/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "mock_auth",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "third-party-accounts-create-sheet",
          "scenarioId": "third-party-accounts-create-sheet",
          "scenario": "Third-party accounts create sheet.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/user/third-party-accounts/page.tsx"
          ],
          "capture": "viewport",
          "authLane": "mock_auth",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "third-party-accounts-edit-sheet",
          "scenarioId": "third-party-accounts-edit-sheet",
          "scenario": "Third-party accounts edit sheet with seeded custom connection.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/user/third-party-accounts/page.tsx"
          ],
          "capture": "viewport",
          "authLane": "mock_auth",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "workspace-settings-feishu-enabled",
          "scenarioId": "workspace-settings-feishu-enabled",
          "scenario": "Workspace settings with Feishu integration already enabled.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/settings/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "workspace-feishu-setup-credentials",
          "scenarioId": "workspace-feishu-setup-credentials",
          "scenario": "Workspace Feishu settings on the credentials step.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/settings/feishu/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "workspace-feishu-locked",
          "scenarioId": "workspace-feishu-locked",
          "scenario": "Feishu integration locked after enablement.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/settings/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "workspace-connections-feishu-disabled",
          "scenarioId": "workspace-connections-feishu-disabled",
          "scenario": "Workspace connections index with Feishu disabled.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/connections/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ],
          "semanticAssertions": {
            "primaryActionTestIds": [],
            "maxProminentActions": 0,
            "forbiddenVisibleTextPatterns": [
              "\\b\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z\\b"
            ]
          }
        },
        {
          "sceneId": "workspace-connections-feishu-connected",
          "scenarioId": "workspace-connections-feishu-connected",
          "scenario": "Workspace connections index with Feishu connected.",
          "group": "workspace_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/connections/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ],
          "semanticAssertions": {
            "primaryActionTestIds": [],
            "maxProminentActions": 0,
            "forbiddenVisibleTextPatterns": [
              "\\b\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z\\b"
            ]
          }
        },
        {
          "sceneId": "credentials",
          "scenarioId": "credentials",
          "scenario": "Project credentials page.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/credentials/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "dialog-create-credential",
          "scenarioId": "dialog-create-credential",
          "scenario": "Create-credential dialog.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/credentials/CreateCredentialDialog.tsx"
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
  "family": "mock-lane-connections-and-credentials-lifecycle",
  "personas": [
    "workspace member",
    "workspace admin",
    "project owner"
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
Mock lane personal/workspace/project connections lifecycle family source.
