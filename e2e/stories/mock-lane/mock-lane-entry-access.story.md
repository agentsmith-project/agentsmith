---
{
  "storyId": "mock-lane-entry-access",
  "title": "Mock lane entry/access visual scenes",
  "actor": "public visitor / system 管理侧 / workspace member",
  "lane": "mock-lane",
  "entryRoute": "/en-US/join",
  "goal": "用一份 mock-lane story family 统一描述入口、登录和桌面接续的 visual scene 真相。",
  "narrative": "Entry/access scenes cover the public join flow, system login, workspace selector, workspace login, and desktop handoff surfaces.",
  "scenes": [
    {
      "sceneId": "join",
      "route": "/en-US/join",
      "recipeFamily": "public_auth_single",
      "authLane": "public",
      "stableMarkers": [
        "public-auth__shell"
      ]
    },
    {
      "sceneId": "system-login",
      "route": "/en-US/system/login",
      "recipeFamily": "public_auth_split",
      "authLane": "public",
      "stableMarkers": [
        "system-login__heading",
        "system-login__submit"
      ]
    },
    {
      "sceneId": "workspace-select",
      "route": "/en-US/login/workspace",
      "recipeFamily": "public_auth_single",
      "authLane": "public",
      "stableMarkers": [
        "workspace-select__heading",
        "workspace-select__list",
        "workspace-select__system-link"
      ]
    },
    {
      "sceneId": "workspace-login",
      "route": "/en-US/workspaces/ws_default/login",
      "recipeFamily": "public_auth_single",
      "authLane": "public",
      "stableMarkers": [
        "public-auth__shell",
        "workspace-login__heading",
        "workspace-login__keycloak-btn"
      ]
    },
    {
      "sceneId": "desktop-auth-request",
      "route": "/en-US/desktop/auth/request",
      "recipeFamily": "public_auth_split",
      "authLane": "public",
      "stableMarkers": [
        "desktop-auth-request__title"
      ]
    },
    {
      "sceneId": "desktop-auth-complete",
      "route": "/en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001",
      "recipeFamily": "public_auth_single",
      "authLane": "public",
      "stableMarkers": [
        "desktop-auth-complete__title",
        "desktop-auth-complete__workspace-entry-link"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-system-login",
      "sceneId": "system-login",
      "intent": "Open the system login entry.",
      "action": "Open system login",
      "target": "system-login__heading",
      "expectedFeedback": "system 管理侧登录入口",
      "note": "入口登录应保持单列、低心智负担。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-workspace-login",
      "sceneId": "workspace-login",
      "intent": "Open the workspace login entry.",
      "action": "Open workspace login",
      "target": "workspace-login__heading",
      "expectedFeedback": "工作区登录入口",
      "note": "workspace 登录应保持 public auth shell recipe。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "join",
          "scenarioId": "join",
          "scenario": "Public join flow entry state.",
          "group": "public_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/join/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "public",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "system-login",
          "scenarioId": "system-login",
          "scenario": "System 管理侧 sign-in page.",
          "group": "public_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/system/login/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "public",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "workspace-select",
          "scenarioId": "workspace-select",
          "scenario": "Workspace selection entry page.",
          "group": "public_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/auth/WorkspaceSelectView.tsx"
          ],
          "capture": "full_page",
          "authLane": "public",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "workspace-login",
          "scenarioId": "workspace-login",
          "scenario": "Workspace login page.",
          "group": "public_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/login/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "public",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "desktop-auth-request",
          "scenarioId": "desktop-auth-request",
          "scenario": "Desktop handoff missing-link recovery page with guidance back to workspace login.",
          "group": "public_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/desktop/auth/request/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "public",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "desktop-auth-complete",
          "scenarioId": "desktop-auth-complete",
          "scenario": "Desktop handoff completion page.",
          "group": "public_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/desktop/auth/complete/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "public",
          "themes": [
            "light",
            "dark"
          ]
        }
      ]
    }
  },
  "family": "mock-lane-entry-access",
  "personas": [
    "public visitor",
    "system 管理侧",
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
Mock lane entry/access visual scene family source.
