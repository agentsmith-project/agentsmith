---
{
  "storyId": "mock-lane-settings-and-members-review",
  "title": "Mock lane settings and members review scenes",
  "actor": "project owner / project admin / workspace admin",
  "lane": "mock-lane",
  "family": "settings-and-members-review",
  "entryRoute": "/en-US/workspaces/ws_default/projects/proj_001/settings",
  "goal": "用一组 mock-lane story scenes 统一描述项目 owner 在设置与成员治理中做 review 的高频心智。",
  "narrative": "Settings and members review scenes cover the project settings sheet and the members governance table that a project owner uses when checking ownership, access, and admin settings.",
  "preconditions": [
    "workspace ws_default and project proj_001 are available in the mock lane"
  ],
  "scenes": [
    {
      "sceneId": "project-settings-review",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/settings",
      "recipeFamily": "settings_sheet",
      "authLane": "authed",
      "stableMarkers": [
        "settings__summary-line",
        "settings__general-section",
        "settings__ownership-section",
        "settings__project-admins-section"
      ]
    },
    {
      "sceneId": "project-members-review",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/members",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": [
        "members__work-surface",
        "members__table",
        "members__invite-btn"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "project-settings-review-open",
      "sceneId": "project-settings-review",
      "intent": "Open project settings and confirm the ownership/admin review sections are visible.",
      "action": "Review project settings",
      "target": "settings__summary-line",
      "expectedFeedback": "Project settings review surface is ready.",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "project-members-review-open",
      "sceneId": "project-members-review",
      "intent": "Open the members governance table and confirm the invite action is visible.",
      "action": "Review members",
      "target": "members__invite-btn",
      "expectedFeedback": "Member governance review surface is ready.",
      "evidence": [
        "trace"
      ]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "project-settings-review",
          "scenarioId": "project-settings-review",
          "scenario": "Project settings review page with governance sections visible.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/settings/page.tsx",
            "src/app/[locale]/workspaces/[workspace]/settings/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "project-members-review",
          "scenarioId": "project-members-review",
          "scenario": "Project members review page with the governance table and invite action visible.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/members/page.tsx",
            "src/components/members/MembersPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        }
      ]
    }
  },
  "personas": [
    "project owner",
    "project admin",
    "workspace admin"
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
Mock lane settings and members review visual scene family source.
