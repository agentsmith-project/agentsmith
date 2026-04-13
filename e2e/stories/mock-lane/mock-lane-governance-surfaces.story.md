---
{
  "storyId": "mock-lane-governance-surfaces",
  "title": "Mock lane governance visual scenes",
  "actor": "system 管理侧 / project owner / project admin",
  "lane": "mock-lane",
  "entryRoute": "/en-US/system/workspaces",
  "goal": "统一描述 system 管理侧与 project governance 核心面的 mock-lane visual scene 真相。",
  "narrative": "Governance scenes cover system workspace management, membership and access governance, agents, endpoints, resource policy, and project settings surfaces without mixing in monitoring or connection lifecycle flows.",
  "scenes": [
    {
      "sceneId": "system-workspaces",
      "route": "/en-US/system/workspaces",
      "recipeFamily": "system_admin_detail",
      "authLane": "system_admin",
      "stableMarkers": [
        "system-workspaces__list",
        "system-workspaces__editor-empty"
      ]
    },
    {
      "sceneId": "system-workspaces-edit-mode",
      "route": "/en-US/system/workspaces",
      "recipeFamily": "system_admin_detail",
      "authLane": "system_admin",
      "stableMarkers": [
        "system-workspaces__list",
        "system-workspaces__editor",
        "system-workspaces__basics"
      ]
    },
    {
      "sceneId": "system-workspaces-create-wizard",
      "route": "/en-US/system/workspaces/new",
      "recipeFamily": "system_admin_detail",
      "authLane": "system_admin",
      "stableMarkers": [
        "system-workspace-create__shell",
        "system-workspace-create__step-tracker",
        "system-workspace-create__next"
      ]
    },
    {
      "sceneId": "system-workspaces-failed-state",
      "route": "/en-US/system/workspaces",
      "recipeFamily": "system_admin_detail",
      "authLane": "system_admin",
      "stableMarkers": [
        "system-workspaces__list",
        "system-workspaces__editor",
        "system-workspaces__card--ws_seeded",
        "system-workspaces__read-only-notice"
      ]
    },
    {
      "sceneId": "system-workspaces-delete-confirmation",
      "route": "/en-US/system/workspaces",
      "recipeFamily": "overlay_dialog",
      "authLane": "system_admin",
      "stableMarkers": [
        "system-workspaces__delete-dialog",
        "system-workspaces__delete-cancel",
        "system-workspaces__delete-confirm"
      ]
    },
    {
      "sceneId": "system-info",
      "route": "/en-US/system/info",
      "recipeFamily": "system_admin_detail",
      "authLane": "system_admin",
      "stableMarkers": [
        "system-info__shell",
        "system-info__health",
        "system-info__next-steps"
      ]
    },
    {
      "sceneId": "agents",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agents",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "dialog-create-agent",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/agents",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "endpoints",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/endpoints",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": [
        "endpoints__work-toolbar",
        "endpoints__create-btn"
      ]
    },
    {
      "sceneId": "dialog-edit-endpoint",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/endpoints",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "dialog-create-endpoint",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/endpoints",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "project-personal-context",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/my-context",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": [
        "context-store__list-card",
        "context-store__editor-card"
      ]
    },
    {
      "sceneId": "members",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/members",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": [
        "members__work-surface",
        "members__invite-btn"
      ]
    },
    {
      "sceneId": "members-effective-access-drawer",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/members?member_tab=people",
      "recipeFamily": "overlay_sheet",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "members-join-requests-tab",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/members",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "members-project-groups",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/members",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "members-change-history-dialog",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/members",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "dialog-invite-member",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/members",
      "recipeFamily": "overlay_dialog",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "resource-policy",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/resource-policy",
      "recipeFamily": "governance_table_detail",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "access-guide",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/use-guide",
      "recipeFamily": "work_surface_standard",
      "authLane": "authed",
      "stableMarkers": []
    },
    {
      "sceneId": "settings",
      "route": "/en-US/workspaces/ws_default/projects/proj_001/settings",
      "recipeFamily": "settings_sheet",
      "authLane": "authed",
      "stableMarkers": [
        "settings__summary-line",
        "settings__general-section",
        "settings__ownership-section",
        "settings__project-admins-section"
      ]
    }
  ],
  "steps": [
    {
      "stepId": "open-system-workspaces",
      "sceneId": "system-workspaces-edit-mode",
      "intent": "Open the system workspace editor surface.",
      "action": "Open system workspaces",
      "target": "system-workspaces__list",
      "expectedFeedback": "system 管理侧的工作区编辑面可见。",
      "note": "system 管理侧治理面应保持单一 detail 工作面。",
      "evidence": [
        "trace"
      ]
    },
    {
      "stepId": "open-members-governance",
      "sceneId": "members",
      "intent": "Open the project membership governance surface.",
      "action": "Open members",
      "target": "members__work-surface",
      "expectedFeedback": "成员治理面可见。",
      "note": "成员治理应保持单一治理表面，不应退化成碎片化卡片流。",
      "evidence": [
        "trace"
      ]
    }
  ],
  "runtimeData": {
    "visualReview": {
      "scenes": [
        {
          "sceneId": "system-workspaces",
          "scenarioId": "system-workspaces",
          "scenario": "System workspaces page in default list/detail state.",
          "group": "system_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/system/SystemWorkspacesPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "system_admin",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "system-workspaces-edit-mode",
          "scenarioId": "system-workspaces-edit-mode",
          "scenario": "System workspaces page in editor mode.",
          "group": "system_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/system/SystemWorkspacesPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "system_admin",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "system-workspaces-create-wizard",
          "scenarioId": "system-workspaces-create-wizard",
          "scenario": "System workspace creation wizard.",
          "group": "system_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/system/SystemWorkspaceCreatePage.tsx"
          ],
          "capture": "full_page",
          "authLane": "system_admin",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "system-workspaces-failed-state",
          "scenarioId": "system-workspaces-failed-state",
          "scenario": "System workspaces list with failed provisioning state.",
          "group": "system_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/system/SystemWorkspacesPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "system_admin",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "system-workspaces-delete-confirmation",
          "scenarioId": "system-workspaces-delete-confirmation",
          "scenario": "Delete confirmation dialog from system workspaces.",
          "group": "system_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/system/SystemWorkspacesPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "system_admin",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "system-info",
          "scenarioId": "system-info",
          "scenario": "System information page.",
          "group": "system_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/system/SystemInfoPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "system_admin",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "agents",
          "scenarioId": "agents",
          "scenario": "Agents index page.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agents/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "dialog-create-agent",
          "scenarioId": "dialog-create-agent",
          "scenario": "Create-agent dialog.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/agents/CreateAgentDialog.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "endpoints",
          "scenarioId": "endpoints",
          "scenario": "Endpoints page.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "dialog-edit-endpoint",
          "scenarioId": "dialog-edit-endpoint",
          "scenario": "Edit-endpoint dialog.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/endpoints/endpoints-page/EndpointsToolbar.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "dialog-create-endpoint",
          "scenarioId": "dialog-create-endpoint",
          "scenario": "Create-endpoint dialog.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/endpoints/CreateEndpointDialog.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "project-personal-context",
          "scenarioId": "project-personal-context",
          "scenario": "Project personal context page for the current member.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/my-context/page.tsx",
            "src/components/context/ContextManager.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "members",
          "scenarioId": "members",
          "scenario": "Members and access governance page.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/members/MembersPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "members-effective-access-drawer",
          "scenarioId": "members-effective-access-drawer",
          "scenario": "Effective access drawer from members page.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/members/MembersPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "members-join-requests-tab",
          "scenarioId": "members-join-requests-tab",
          "scenario": "Members page with join-requests tab active.",
          "group": "overlay_cases",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/members/JoinRequestsTab.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "members-project-groups",
          "scenarioId": "members-project-groups",
          "scenario": "Members page groups tab.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/members/MembersPage.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "members-change-history-dialog",
          "scenarioId": "members-change-history-dialog",
          "scenario": "Change-history dialog from member detail.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/members/MembersPage.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "dialog-invite-member",
          "scenarioId": "dialog-invite-member",
          "scenario": "Invite-member dialog.",
          "group": "overlay_drawers",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/components/members/InviteMemberDialog.tsx"
          ],
          "capture": "viewport",
          "authLane": "authed",
          "themes": [
            "default"
          ]
        },
        {
          "sceneId": "resource-policy",
          "scenarioId": "resource-policy",
          "scenario": "Resource policy governance page.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "access-guide",
          "scenarioId": "access-guide",
          "scenario": "Project access guide page.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/use-guide/page.tsx"
          ],
          "capture": "full_page",
          "authLane": "authed",
          "themes": [
            "light",
            "dark"
          ]
        },
        {
          "sceneId": "settings",
          "scenarioId": "settings",
          "scenario": "Project settings page.",
          "group": "governance_pages",
          "codeRefs": [
            "e2e/visual.spec.ts",
            "src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/settings/page.tsx"
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
  "family": "mock-lane-governance-surfaces",
  "personas": [
    "system 管理侧",
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
Mock lane governance visual scene family source.
