---
{
  "storyId": "mock-lane-self-service",
  "title": "Mock lane self-service visual scenes",
  "actor": "workspace member",
  "lane": "mock-lane",
  "entryRoute": "/en-US/user/profile",
  "goal": "统一描述用户自助资料与 API key 管理的 mock-lane visual scenes。",
  "narrative": "Self-service scenes cover the member profile surface and API key lifecycle dialogs without mixing in broader connection-management flows.",
  "scenes": [
    {
      "sceneId": "profile",
      "route": "/en-US/user/profile?workspace=ws_default&project=proj_001",
      "recipeFamily": "settings_sheet",
      "authLane": "mock_auth",
      "stableMarkers": [
        "profile__form",
        "profile__save-btn"
      ]
    },
    {
      "sceneId": "api-keys",
      "route": "/en-US/user/api-keys",
      "recipeFamily": "settings_sheet",
      "authLane": "mock_auth",
      "stableMarkers": [
        "api-keys__list-section",
        "api-keys__create-btn"
      ]
    },
    {
      "sceneId": "api-keys-create-dialog",
      "route": "/en-US/user/api-keys",
      "recipeFamily": "overlay_dialog",
      "authLane": "mock_auth",
      "stableMarkers": [
        "api-keys__create-dialog"
      ]
    },
    {
      "sceneId": "api-keys-key-created-dialog",
      "route": "/en-US/user/api-keys",
      "recipeFamily": "overlay_dialog",
      "authLane": "mock_auth",
      "stableMarkers": [
        "api-keys__key-created-dialog"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-profile",
      "sceneId": "profile",
      "intent": "Open the profile self-service page.",
      "action": "Open profile",
      "target": "profile__form",
      "expectedFeedback": "个人信息表单可编辑。",
      "note": "用户自助面应保持一条主表单线。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-api-keys",
      "sceneId": "api-keys",
      "intent": "Open the API keys self-service page.",
      "action": "Open API keys",
      "target": "api-keys__list-section",
      "expectedFeedback": "API key 清单可见。",
      "note": "自助凭据面应保持连续设置面，而不是切回 dashboard 入口。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "profile",
          "scenarioId": "profile",
          "scenario": "User profile settings page.",
          "group": "user_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/user/profile/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "mock_auth",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "api-keys",
          "scenarioId": "api-keys",
          "scenario": "API keys self-service page.",
          "group": "user_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/user/api-keys/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "mock_auth",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "api-keys-create-dialog",
          "scenarioId": "api-keys-create-dialog",
          "scenario": "API keys create dialog.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/user/api-keys/_components/CreateApiKeyDialog.tsx"
          ],
          "capture": "viewport",
          "authLane": "mock_auth",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "api-keys-key-created-dialog",
          "scenarioId": "api-keys-key-created-dialog",
          "scenario": "API keys success dialog after creating a new key.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/api-keys/KeyCreatedDialog.tsx"
          ],
          "capture": "viewport",
          "authLane": "mock_auth",
          "themes": [
            "light",
            "dark"
          ]
        }
      ]
    }
  },
  "family": "mock-lane-self-service",
  "personas": [
    "workspace member"
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
Mock lane self-service visual scene family source.
