---
{
  "storyId": "mock-lane-connections-and-credentials-lifecycle",
  "title": "Mock lane personal connections and credentials lifecycle scenes",
  "actor": "workspace member / workspace admin / project owner",
  "lane": "mock-lane",
  "entryRoute": "/en-US/user/third-party-accounts",
  "goal": "统一描述个人 custom secret bundle 和项目凭据生命周期的 mock-lane visual scene 真相。",
  "narrative": "Lifecycle scenes cover personal custom secret bundles and project credential management surfaces so credential setup can be reviewed without provider-specific workspace integration assumptions.",
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
